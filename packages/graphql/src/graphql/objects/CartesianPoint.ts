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

import { GraphQLFloat, GraphQLInt, GraphQLNonNull, GraphQLObjectType, GraphQLString } from "graphql";
import { numericalResolver } from "../../schema/resolvers/field/numerical";

export const CartesianPoint = new GraphQLObjectType({
    name: "CartesianPoint",
    description:
        "A point in a two- or three-dimensional Cartesian coordinate system or in a three-dimensional cylindrical coordinate system.",
    fields: {
        x: {
            type: new GraphQLNonNull(GraphQLFloat),
            resolve: (source) => source.point.x,
        },
        y: {
            type: new GraphQLNonNull(GraphQLFloat),
            resolve: (source) => source.point.y,
        },
        z: {
            type: GraphQLFloat,
            resolve: (source) => source.point.z,
        },
        crs: {
            type: new GraphQLNonNull(GraphQLString),
            description:
                "The coordinate reference systems (CRS)\n" +
                "-------------------------------------\n" +
                "possible values:\n" +
                "* `cartesian`: A 2D point in the Cartesian CRS is specified with a map containing x and y coordinate values\n" +
                "* `cartesian-3d`: A 3D point in the Cartesian CRS is specified with a map containing x, y and z coordinate values",
        },
        srid: {
            type: new GraphQLNonNull(GraphQLInt),
            description:
                "The internal Neo4j ID for the CRS\n" +
                "One of:\n" +
                "* `7203`: represents CRS `cartesian`\n" +
                "* `9157`: represents CRS `cartesian-3d`",
            resolve: (source, args, context, info) => numericalResolver(source.point, args, context, info),
        },
    },
});
