/*
 * Copyright (c) "Neo4j"
 * Neo4j Sweden AB [http://neo4j.com]
 *
 * This file is part of Neo4j.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { GraphQLInt, GraphQLNonNull, GraphQLString } from "graphql";
import type { SchemaComposer } from "graphql-compose";
import type { Node } from "../../classes";

import type { ConcreteEntityAdapter } from "../../schema-model/entity/model-adapters/ConcreteEntityAdapter";
import {
    withFullTextInputType,
    withFullTextResultType,
    withFullTextSortInputType,
    withFullTextWhereInputType,
} from "../generation/fulltext-input";
import { fulltextResolver } from "../resolvers/query/fulltext";

export function augmentFulltextSchema(
    node: Node,
    composer: SchemaComposer,
    concreteEntityAdapter: ConcreteEntityAdapter
) {
    if (!concreteEntityAdapter.annotations.fulltext) {
        return;
    }

    withFullTextInputType({ concreteEntityAdapter, composer });
    withFullTextWhereInputType({ composer, concreteEntityAdapter });

    /**
     * TODO [fulltext-deprecations]
     * to move this over to the concreteEntityAdapter we need to check what the use of
     * the queryType and scoreVariable properties are in FulltextContext
     *  and determine if we can remove them
     */
    concreteEntityAdapter.annotations.fulltext.indexes.forEach((index) => {
        let queryName = concreteEntityAdapter.operations.getFullTextIndexQueryFieldName(index.indexName);
        if (index.queryName) {
            queryName = index.queryName;
        }
        const nodeIndex = node.fulltextDirective!.indexes.find((i) => {
            return i.indexName === index.indexName;
        });
        if (!nodeIndex) {
            throw new Error(`Could not find index ${index.indexName} on node ${node.name}`);
        }
        composer.Query.addFields({
            [queryName]: {
                type: withFullTextResultType({ composer, concreteEntityAdapter }).NonNull.List.NonNull,
                description:
                    "Query a full-text index. This query returns the query score, but does not allow for aggregations. Use the `fulltext` argument under other queries for this functionality.",
                resolve: fulltextResolver({ node, index: nodeIndex, entityAdapter: concreteEntityAdapter }),
                args: {
                    phrase: new GraphQLNonNull(GraphQLString),
                    where: concreteEntityAdapter.operations.fulltextTypeNames.where,
                    sort: withFullTextSortInputType({ concreteEntityAdapter, composer }).NonNull.List,
                    limit: GraphQLInt,
                    offset: GraphQLInt,
                },
            },
        });
    });
}
