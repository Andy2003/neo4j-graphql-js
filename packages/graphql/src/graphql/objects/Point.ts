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

export const Point = new GraphQLObjectType({
    name: "Point",
    description: "A point in a coordinate system.",
    fields: {
        longitude: {
            type: new GraphQLNonNull(GraphQLFloat),
            description:
                "The first element of the Coordinate for geographic CRS, degrees East of the prime meridian\n" +
                "Range -180.0 to 180.0",
            resolve: (source) => source.point.x,
        },
        latitude: {
            type: new GraphQLNonNull(GraphQLFloat),
            description:
                "The second element of the Coordinate for geographic CRS, degrees North of the equator\n" +
                "Range -90.0 to 90.0",
            resolve: (source) => source.point.y,
        },
        height: {
            type: GraphQLFloat,
            description:
                "The third element of the Coordinate for geographic CRS, meters above the ellipsoid defined by the datum (WGS-84)",
            resolve: (source) => source.point.z,
        },
        crs: {
            type: new GraphQLNonNull(GraphQLString),
            description:
                "The coordinate reference systems (CRS)\n" +
                "-------------------------------------\n" +
                "possible values:\n" +
                "* `wgs-84`: A 2D geographic point in the WGS 84 CRS is specified by: longitude and latitude\n" +
                "* `wgs-84-3d`: A 3D geographic point in the WGS 84 CRS is specified by longitude, latitude and height",
        },
        srid: {
            type: new GraphQLNonNull(GraphQLInt),
            description:
                "The internal Neo4j ID for the CRS\n" +
                "One of:\n" +
                "* `4326`: represents CRS `wgs-84`\n" +
                "* `4979`: represents CRS `wgs-84-3d`",
            resolve: (source, args, context, info) => numericalResolver(source.point, args, context, info),
        },
    },
});
