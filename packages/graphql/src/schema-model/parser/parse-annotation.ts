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

import type { DirectiveNode } from "graphql";
import type { Annotations } from "../annotation/Annotation";
import { annotationsParsers } from "../annotation/Annotation";
import { MutationAnnotation } from "../annotation/MutationAnnotation";
import { QueryAnnotation } from "../annotation/QueryAnnotation";
import { FilterableAnnotation } from "../annotation/FilterableAnnotation";
import { SelectableAnnotation } from "../annotation/SelectableAnnotation";
import type { BooleanValueNode } from "graphql/index";
import { MutationOperations } from "../../graphql/directives/mutation";

export function parseAnnotations(directives: readonly DirectiveNode[]): Partial<Annotations> {
    const groupedDirectives = new Map<string, DirectiveNode[]>();
    for (const directive of directives) {
        const directivesOfName = groupedDirectives.get(directive.name.value) ?? [];
        groupedDirectives.set(directive.name.value, [...directivesOfName, directive]);
    }

    const result: Partial<Annotations> = {};
    for (const [name, parser] of Object.entries(annotationsParsers)) {
        const relevantDirectives = groupedDirectives.get(name) ?? [];
        const firstDirective = relevantDirectives[0];
        if (firstDirective) {
            result[name] = parser(firstDirective, relevantDirectives);
        }
    }
    const allowedAnnotations: (keyof Annotations)[] = [
        "query",
        // "mutation",
        "customResolver",
        "coalesce",
        "filterable",
        "id",
        "plural",
        "private",
        "query",
        "selectable",
        "limit",
        "default",
    ];

    for (const key of Object.keys(result)) {
        if (result[key] !== undefined && !allowedAnnotations.includes(key as keyof Annotations)) {
            // result[key] = undefined;
            throw new Error("skip test");
        }
    }
    if (result.query?.aggregate || result.filterable?.byAggregate || result.selectable?.onAggregate) {
        throw new Error("skip test");
    }

    groupedDirectives.get("relationship")?.some((directive) => {
        const aggregate = directive.arguments?.find((arg) => arg.name.value === "aggregate");
        if (aggregate && (aggregate.value as BooleanValueNode).value) {
            throw new Error("skip test");
        }
    });

    if (!result.filterable) {
        result.filterable = new FilterableAnnotation({ byValue: true, byAggregate: false });
    }
    if (!result.selectable) {
        result.selectable = new SelectableAnnotation({ onRead: true, onAggregate: false });
    }
    if (!result.query) {
        result.query = new QueryAnnotation({ read: true, aggregate: false });
    }
    if (result.mutation) {
        // if ([...result.mutation.operations].some((value) => value !== MutationOperations.DELETE)) {
        throw new Error("skip test");
        // }
    } else {
        result.mutation = new MutationAnnotation({ operations: new Set([]) });
    }
    return result;
}
