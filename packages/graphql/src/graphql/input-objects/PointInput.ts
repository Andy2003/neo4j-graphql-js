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

import { GraphQLFloat, GraphQLInputObjectType, GraphQLNonNull } from "graphql";

export const PointInput = new GraphQLInputObjectType({
    name: "PointInput",
    description: "Input type for a point",
    fields: {
        longitude: {
            type: new GraphQLNonNull(GraphQLFloat),
            description:
                "The first element of the Coordinate for geographic CRS, degrees East of the prime meridian\n" +
                "Range -180.0 to 180.0",
        },
        latitude: {
            type: new GraphQLNonNull(GraphQLFloat),
            description:
                "The second element of the Coordinate for geographic CRS, degrees North of the equator\n" +
                "Range -90.0 to 90.0",
        },
        height: {
            type: GraphQLFloat,
            description:
                "The third element of the Coordinate for geographic CRS, meters above the ellipsoid defined by the datum (WGS-84)",
        },
    },
});
