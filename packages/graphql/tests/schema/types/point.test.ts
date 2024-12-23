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

import { printSchemaWithDirectives } from "@graphql-tools/utils";
import { lexicographicSortSchema } from "graphql/utilities";
import { gql } from "graphql-tag";
import { Neo4jGraphQL } from "../../../src";

describe("Point", () => {
    test("Point", async () => {
        const typeDefs = gql`
            type Movie {
                filmedAt: Point!
            }
        `;
        const neoSchema = new Neo4jGraphQL({ typeDefs });
        const printedSchema = printSchemaWithDirectives(lexicographicSortSchema(await neoSchema.getSchema()));

        expect(printedSchema).toMatchInlineSnapshot(`
            "schema {
              query: Query
              mutation: Mutation
            }

            \\"\\"\\"
            Information about the number of nodes and relationships created during a create mutation
            \\"\\"\\"
            type CreateInfo {
              bookmark: String @deprecated(reason: \\"This field has been deprecated because bookmarks are now handled by the driver.\\")
              nodesCreated: Int!
              relationshipsCreated: Int!
            }

            type CreateMoviesMutationResponse {
              info: CreateInfo!
              movies: [Movie!]!
            }

            \\"\\"\\"
            Information about the number of nodes and relationships deleted during a delete mutation
            \\"\\"\\"
            type DeleteInfo {
              bookmark: String @deprecated(reason: \\"This field has been deprecated because bookmarks are now handled by the driver.\\")
              nodesDeleted: Int!
              relationshipsDeleted: Int!
            }

            type Movie {
              filmedAt: Point!
            }

            type MovieAggregateSelection {
              count: Int!
            }

            input MovieCreateInput {
              filmedAt: PointInput!
            }

            type MovieEdge {
              cursor: String!
              node: Movie!
            }

            input MovieOptions {
              limit: Int
              offset: Int
              \\"\\"\\"
              Specify one or more MovieSort objects to sort Movies by. The sorts will be applied in the order in which they are arranged in the array.
              \\"\\"\\"
              sort: [MovieSort!]
            }

            \\"\\"\\"
            Fields to sort Movies by. The order in which sorts are applied is not guaranteed when specifying many fields in one MovieSort object.
            \\"\\"\\"
            input MovieSort {
              filmedAt: SortDirection
            }

            input MovieUpdateInput {
              filmedAt: PointInput
            }

            input MovieWhere {
              AND: [MovieWhere!]
              NOT: MovieWhere
              OR: [MovieWhere!]
              filmedAt: PointInput
              filmedAt_DISTANCE: PointDistance
              filmedAt_GT: PointDistance
              filmedAt_GTE: PointDistance
              filmedAt_IN: [PointInput!]
              filmedAt_LT: PointDistance
              filmedAt_LTE: PointDistance
              filmedAt_NOT: PointInput @deprecated(reason: \\"Negation filters will be deprecated, use the NOT operator to achieve the same behavior\\")
              filmedAt_NOT_IN: [PointInput!] @deprecated(reason: \\"Negation filters will be deprecated, use the NOT operator to achieve the same behavior\\")
            }

            type MoviesConnection {
              edges: [MovieEdge!]!
              pageInfo: PageInfo!
              totalCount: Int!
            }

            type Mutation {
              createMovies(input: [MovieCreateInput!]!): CreateMoviesMutationResponse!
              deleteMovies(where: MovieWhere): DeleteInfo!
              updateMovies(update: MovieUpdateInput, where: MovieWhere): UpdateMoviesMutationResponse!
            }

            \\"\\"\\"Pagination information (Relay)\\"\\"\\"
            type PageInfo {
              endCursor: String
              hasNextPage: Boolean!
              hasPreviousPage: Boolean!
              startCursor: String
            }

            \\"\\"\\"A point in a coordinate system.\\"\\"\\"
            type Point {
              \\"\\"\\"
              The coordinate reference systems (CRS)
              -------------------------------------
              possible values:
              * \`wgs-84\`: A 2D geographic point in the WGS 84 CRS is specified by: longitude and latitude
              * \`wgs-84-3d\`: A 3D geographic point in the WGS 84 CRS is specified by longitude, latitude and height
              \\"\\"\\"
              crs: String!
              \\"\\"\\"
              The third element of the Coordinate for geographic CRS, meters above the ellipsoid defined by the datum (WGS-84)
              \\"\\"\\"
              height: Float
              \\"\\"\\"
              The second element of the Coordinate for geographic CRS, degrees North of the equator
              Range -90.0 to 90.0
              \\"\\"\\"
              latitude: Float!
              \\"\\"\\"
              The first element of the Coordinate for geographic CRS, degrees East of the prime meridian
              Range -180.0 to 180.0
              \\"\\"\\"
              longitude: Float!
              \\"\\"\\"
              The internal Neo4j ID for the CRS
              One of:
              * \`4326\`: represents CRS \`wgs-84\`
              * \`4979\`: represents CRS \`wgs-84-3d\`
              \\"\\"\\"
              srid: Int!
            }

            \\"\\"\\"Input type for a point with a distance\\"\\"\\"
            input PointDistance {
              \\"\\"\\"The distance in metres to be used when comparing two points\\"\\"\\"
              distance: Float!
              point: PointInput!
            }

            \\"\\"\\"Input type for a point\\"\\"\\"
            input PointInput {
              \\"\\"\\"
              The third element of the Coordinate for geographic CRS, meters above the ellipsoid defined by the datum (WGS-84)
              \\"\\"\\"
              height: Float
              \\"\\"\\"
              The second element of the Coordinate for geographic CRS, degrees North of the equator
              Range -90.0 to 90.0
              \\"\\"\\"
              latitude: Float!
              \\"\\"\\"
              The first element of the Coordinate for geographic CRS, degrees East of the prime meridian
              Range -180.0 to 180.0
              \\"\\"\\"
              longitude: Float!
            }

            type Query {
              movies(options: MovieOptions, where: MovieWhere): [Movie!]!
              moviesAggregate(where: MovieWhere): MovieAggregateSelection!
              moviesConnection(after: String, first: Int, sort: [MovieSort], where: MovieWhere): MoviesConnection!
            }

            \\"\\"\\"An enum for sorting in either ascending or descending order.\\"\\"\\"
            enum SortDirection {
              \\"\\"\\"Sort by field values in ascending order.\\"\\"\\"
              ASC
              \\"\\"\\"Sort by field values in descending order.\\"\\"\\"
              DESC
            }

            \\"\\"\\"
            Information about the number of nodes and relationships created and deleted during an update mutation
            \\"\\"\\"
            type UpdateInfo {
              bookmark: String @deprecated(reason: \\"This field has been deprecated because bookmarks are now handled by the driver.\\")
              nodesCreated: Int!
              nodesDeleted: Int!
              relationshipsCreated: Int!
              relationshipsDeleted: Int!
            }

            type UpdateMoviesMutationResponse {
              info: UpdateInfo!
              movies: [Movie!]!
            }"
        `);
    });

    test("CartesianPoint", async () => {
        const typeDefs = gql`
            type Machine {
                partLocation: CartesianPoint!
            }
        `;
        const neoSchema = new Neo4jGraphQL({ typeDefs });
        const printedSchema = printSchemaWithDirectives(lexicographicSortSchema(await neoSchema.getSchema()));

        expect(printedSchema).toMatchInlineSnapshot(`
            "schema {
              query: Query
              mutation: Mutation
            }

            \\"\\"\\"
            A point in a two- or three-dimensional Cartesian coordinate system or in a three-dimensional cylindrical coordinate system.
            \\"\\"\\"
            type CartesianPoint {
              \\"\\"\\"
              The coordinate reference systems (CRS)
              -------------------------------------
              possible values:
              * \`cartesian\`: A 2D point in the Cartesian CRS is specified with a map containing x and y coordinate values
              * \`cartesian-3d\`: A 3D point in the Cartesian CRS is specified with a map containing x, y and z coordinate values
              \\"\\"\\"
              crs: String!
              \\"\\"\\"
              The internal Neo4j ID for the CRS
              One of:
              * \`7203\`: represents CRS \`cartesian\`
              * \`9157\`: represents CRS \`cartesian-3d\`
              \\"\\"\\"
              srid: Int!
              x: Float!
              y: Float!
              z: Float
            }

            \\"\\"\\"Input type for a cartesian point with a distance\\"\\"\\"
            input CartesianPointDistance {
              distance: Float!
              point: CartesianPointInput!
            }

            \\"\\"\\"Input type for a cartesian point\\"\\"\\"
            input CartesianPointInput {
              x: Float!
              y: Float!
              z: Float
            }

            \\"\\"\\"
            Information about the number of nodes and relationships created during a create mutation
            \\"\\"\\"
            type CreateInfo {
              bookmark: String @deprecated(reason: \\"This field has been deprecated because bookmarks are now handled by the driver.\\")
              nodesCreated: Int!
              relationshipsCreated: Int!
            }

            type CreateMachinesMutationResponse {
              info: CreateInfo!
              machines: [Machine!]!
            }

            \\"\\"\\"
            Information about the number of nodes and relationships deleted during a delete mutation
            \\"\\"\\"
            type DeleteInfo {
              bookmark: String @deprecated(reason: \\"This field has been deprecated because bookmarks are now handled by the driver.\\")
              nodesDeleted: Int!
              relationshipsDeleted: Int!
            }

            type Machine {
              partLocation: CartesianPoint!
            }

            type MachineAggregateSelection {
              count: Int!
            }

            input MachineCreateInput {
              partLocation: CartesianPointInput!
            }

            type MachineEdge {
              cursor: String!
              node: Machine!
            }

            input MachineOptions {
              limit: Int
              offset: Int
              \\"\\"\\"
              Specify one or more MachineSort objects to sort Machines by. The sorts will be applied in the order in which they are arranged in the array.
              \\"\\"\\"
              sort: [MachineSort!]
            }

            \\"\\"\\"
            Fields to sort Machines by. The order in which sorts are applied is not guaranteed when specifying many fields in one MachineSort object.
            \\"\\"\\"
            input MachineSort {
              partLocation: SortDirection
            }

            input MachineUpdateInput {
              partLocation: CartesianPointInput
            }

            input MachineWhere {
              AND: [MachineWhere!]
              NOT: MachineWhere
              OR: [MachineWhere!]
              partLocation: CartesianPointInput
              partLocation_DISTANCE: CartesianPointDistance
              partLocation_GT: CartesianPointDistance
              partLocation_GTE: CartesianPointDistance
              partLocation_IN: [CartesianPointInput!]
              partLocation_LT: CartesianPointDistance
              partLocation_LTE: CartesianPointDistance
              partLocation_NOT: CartesianPointInput @deprecated(reason: \\"Negation filters will be deprecated, use the NOT operator to achieve the same behavior\\")
              partLocation_NOT_IN: [CartesianPointInput!] @deprecated(reason: \\"Negation filters will be deprecated, use the NOT operator to achieve the same behavior\\")
            }

            type MachinesConnection {
              edges: [MachineEdge!]!
              pageInfo: PageInfo!
              totalCount: Int!
            }

            type Mutation {
              createMachines(input: [MachineCreateInput!]!): CreateMachinesMutationResponse!
              deleteMachines(where: MachineWhere): DeleteInfo!
              updateMachines(update: MachineUpdateInput, where: MachineWhere): UpdateMachinesMutationResponse!
            }

            \\"\\"\\"Pagination information (Relay)\\"\\"\\"
            type PageInfo {
              endCursor: String
              hasNextPage: Boolean!
              hasPreviousPage: Boolean!
              startCursor: String
            }

            type Query {
              machines(options: MachineOptions, where: MachineWhere): [Machine!]!
              machinesAggregate(where: MachineWhere): MachineAggregateSelection!
              machinesConnection(after: String, first: Int, sort: [MachineSort], where: MachineWhere): MachinesConnection!
            }

            \\"\\"\\"An enum for sorting in either ascending or descending order.\\"\\"\\"
            enum SortDirection {
              \\"\\"\\"Sort by field values in ascending order.\\"\\"\\"
              ASC
              \\"\\"\\"Sort by field values in descending order.\\"\\"\\"
              DESC
            }

            \\"\\"\\"
            Information about the number of nodes and relationships created and deleted during an update mutation
            \\"\\"\\"
            type UpdateInfo {
              bookmark: String @deprecated(reason: \\"This field has been deprecated because bookmarks are now handled by the driver.\\")
              nodesCreated: Int!
              nodesDeleted: Int!
              relationshipsCreated: Int!
              relationshipsDeleted: Int!
            }

            type UpdateMachinesMutationResponse {
              info: UpdateInfo!
              machines: [Machine!]!
            }"
        `);
    });

    test("Points", async () => {
        const typeDefs = gql`
            type Movie {
                filmedAt: [Point!]!
            }
        `;
        const neoSchema = new Neo4jGraphQL({ typeDefs });
        const printedSchema = printSchemaWithDirectives(lexicographicSortSchema(await neoSchema.getSchema()));

        expect(printedSchema).toMatchInlineSnapshot(`
            "schema {
              query: Query
              mutation: Mutation
            }

            \\"\\"\\"
            Information about the number of nodes and relationships created during a create mutation
            \\"\\"\\"
            type CreateInfo {
              bookmark: String @deprecated(reason: \\"This field has been deprecated because bookmarks are now handled by the driver.\\")
              nodesCreated: Int!
              relationshipsCreated: Int!
            }

            type CreateMoviesMutationResponse {
              info: CreateInfo!
              movies: [Movie!]!
            }

            \\"\\"\\"
            Information about the number of nodes and relationships deleted during a delete mutation
            \\"\\"\\"
            type DeleteInfo {
              bookmark: String @deprecated(reason: \\"This field has been deprecated because bookmarks are now handled by the driver.\\")
              nodesDeleted: Int!
              relationshipsDeleted: Int!
            }

            type Movie {
              filmedAt: [Point!]!
            }

            type MovieAggregateSelection {
              count: Int!
            }

            input MovieCreateInput {
              filmedAt: [PointInput!]!
            }

            type MovieEdge {
              cursor: String!
              node: Movie!
            }

            input MovieOptions {
              limit: Int
              offset: Int
            }

            input MovieUpdateInput {
              filmedAt: [PointInput!]
              filmedAt_POP: Int
              filmedAt_PUSH: [PointInput!]
            }

            input MovieWhere {
              AND: [MovieWhere!]
              NOT: MovieWhere
              OR: [MovieWhere!]
              filmedAt: [PointInput!]
              filmedAt_INCLUDES: PointInput
              filmedAt_NOT: [PointInput!] @deprecated(reason: \\"Negation filters will be deprecated, use the NOT operator to achieve the same behavior\\")
              filmedAt_NOT_INCLUDES: PointInput @deprecated(reason: \\"Negation filters will be deprecated, use the NOT operator to achieve the same behavior\\")
            }

            type MoviesConnection {
              edges: [MovieEdge!]!
              pageInfo: PageInfo!
              totalCount: Int!
            }

            type Mutation {
              createMovies(input: [MovieCreateInput!]!): CreateMoviesMutationResponse!
              deleteMovies(where: MovieWhere): DeleteInfo!
              updateMovies(update: MovieUpdateInput, where: MovieWhere): UpdateMoviesMutationResponse!
            }

            \\"\\"\\"Pagination information (Relay)\\"\\"\\"
            type PageInfo {
              endCursor: String
              hasNextPage: Boolean!
              hasPreviousPage: Boolean!
              startCursor: String
            }

            \\"\\"\\"A point in a coordinate system.\\"\\"\\"
            type Point {
              \\"\\"\\"
              The coordinate reference systems (CRS)
              -------------------------------------
              possible values:
              * \`wgs-84\`: A 2D geographic point in the WGS 84 CRS is specified by: longitude and latitude
              * \`wgs-84-3d\`: A 3D geographic point in the WGS 84 CRS is specified by longitude, latitude and height
              \\"\\"\\"
              crs: String!
              \\"\\"\\"
              The third element of the Coordinate for geographic CRS, meters above the ellipsoid defined by the datum (WGS-84)
              \\"\\"\\"
              height: Float
              \\"\\"\\"
              The second element of the Coordinate for geographic CRS, degrees North of the equator
              Range -90.0 to 90.0
              \\"\\"\\"
              latitude: Float!
              \\"\\"\\"
              The first element of the Coordinate for geographic CRS, degrees East of the prime meridian
              Range -180.0 to 180.0
              \\"\\"\\"
              longitude: Float!
              \\"\\"\\"
              The internal Neo4j ID for the CRS
              One of:
              * \`4326\`: represents CRS \`wgs-84\`
              * \`4979\`: represents CRS \`wgs-84-3d\`
              \\"\\"\\"
              srid: Int!
            }

            \\"\\"\\"Input type for a point\\"\\"\\"
            input PointInput {
              \\"\\"\\"
              The third element of the Coordinate for geographic CRS, meters above the ellipsoid defined by the datum (WGS-84)
              \\"\\"\\"
              height: Float
              \\"\\"\\"
              The second element of the Coordinate for geographic CRS, degrees North of the equator
              Range -90.0 to 90.0
              \\"\\"\\"
              latitude: Float!
              \\"\\"\\"
              The first element of the Coordinate for geographic CRS, degrees East of the prime meridian
              Range -180.0 to 180.0
              \\"\\"\\"
              longitude: Float!
            }

            type Query {
              movies(options: MovieOptions, where: MovieWhere): [Movie!]!
              moviesAggregate(where: MovieWhere): MovieAggregateSelection!
              moviesConnection(after: String, first: Int, where: MovieWhere): MoviesConnection!
            }

            \\"\\"\\"
            Information about the number of nodes and relationships created and deleted during an update mutation
            \\"\\"\\"
            type UpdateInfo {
              bookmark: String @deprecated(reason: \\"This field has been deprecated because bookmarks are now handled by the driver.\\")
              nodesCreated: Int!
              nodesDeleted: Int!
              relationshipsCreated: Int!
              relationshipsDeleted: Int!
            }

            type UpdateMoviesMutationResponse {
              info: UpdateInfo!
              movies: [Movie!]!
            }"
        `);
    });

    test("CartesianPoints", async () => {
        const typeDefs = gql`
            type Machine {
                partLocations: [CartesianPoint!]!
            }
        `;
        const neoSchema = new Neo4jGraphQL({ typeDefs });
        const printedSchema = printSchemaWithDirectives(lexicographicSortSchema(await neoSchema.getSchema()));

        expect(printedSchema).toMatchInlineSnapshot(`
            "schema {
              query: Query
              mutation: Mutation
            }

            \\"\\"\\"
            A point in a two- or three-dimensional Cartesian coordinate system or in a three-dimensional cylindrical coordinate system.
            \\"\\"\\"
            type CartesianPoint {
              \\"\\"\\"
              The coordinate reference systems (CRS)
              -------------------------------------
              possible values:
              * \`cartesian\`: A 2D point in the Cartesian CRS is specified with a map containing x and y coordinate values
              * \`cartesian-3d\`: A 3D point in the Cartesian CRS is specified with a map containing x, y and z coordinate values
              \\"\\"\\"
              crs: String!
              \\"\\"\\"
              The internal Neo4j ID for the CRS
              One of:
              * \`7203\`: represents CRS \`cartesian\`
              * \`9157\`: represents CRS \`cartesian-3d\`
              \\"\\"\\"
              srid: Int!
              x: Float!
              y: Float!
              z: Float
            }

            \\"\\"\\"Input type for a cartesian point\\"\\"\\"
            input CartesianPointInput {
              x: Float!
              y: Float!
              z: Float
            }

            \\"\\"\\"
            Information about the number of nodes and relationships created during a create mutation
            \\"\\"\\"
            type CreateInfo {
              bookmark: String @deprecated(reason: \\"This field has been deprecated because bookmarks are now handled by the driver.\\")
              nodesCreated: Int!
              relationshipsCreated: Int!
            }

            type CreateMachinesMutationResponse {
              info: CreateInfo!
              machines: [Machine!]!
            }

            \\"\\"\\"
            Information about the number of nodes and relationships deleted during a delete mutation
            \\"\\"\\"
            type DeleteInfo {
              bookmark: String @deprecated(reason: \\"This field has been deprecated because bookmarks are now handled by the driver.\\")
              nodesDeleted: Int!
              relationshipsDeleted: Int!
            }

            type Machine {
              partLocations: [CartesianPoint!]!
            }

            type MachineAggregateSelection {
              count: Int!
            }

            input MachineCreateInput {
              partLocations: [CartesianPointInput!]!
            }

            type MachineEdge {
              cursor: String!
              node: Machine!
            }

            input MachineOptions {
              limit: Int
              offset: Int
            }

            input MachineUpdateInput {
              partLocations: [CartesianPointInput!]
              partLocations_POP: Int
              partLocations_PUSH: [CartesianPointInput!]
            }

            input MachineWhere {
              AND: [MachineWhere!]
              NOT: MachineWhere
              OR: [MachineWhere!]
              partLocations: [CartesianPointInput!]
              partLocations_INCLUDES: CartesianPointInput
              partLocations_NOT: [CartesianPointInput!] @deprecated(reason: \\"Negation filters will be deprecated, use the NOT operator to achieve the same behavior\\")
              partLocations_NOT_INCLUDES: CartesianPointInput @deprecated(reason: \\"Negation filters will be deprecated, use the NOT operator to achieve the same behavior\\")
            }

            type MachinesConnection {
              edges: [MachineEdge!]!
              pageInfo: PageInfo!
              totalCount: Int!
            }

            type Mutation {
              createMachines(input: [MachineCreateInput!]!): CreateMachinesMutationResponse!
              deleteMachines(where: MachineWhere): DeleteInfo!
              updateMachines(update: MachineUpdateInput, where: MachineWhere): UpdateMachinesMutationResponse!
            }

            \\"\\"\\"Pagination information (Relay)\\"\\"\\"
            type PageInfo {
              endCursor: String
              hasNextPage: Boolean!
              hasPreviousPage: Boolean!
              startCursor: String
            }

            type Query {
              machines(options: MachineOptions, where: MachineWhere): [Machine!]!
              machinesAggregate(where: MachineWhere): MachineAggregateSelection!
              machinesConnection(after: String, first: Int, where: MachineWhere): MachinesConnection!
            }

            \\"\\"\\"
            Information about the number of nodes and relationships created and deleted during an update mutation
            \\"\\"\\"
            type UpdateInfo {
              bookmark: String @deprecated(reason: \\"This field has been deprecated because bookmarks are now handled by the driver.\\")
              nodesCreated: Int!
              nodesDeleted: Int!
              relationshipsCreated: Int!
              relationshipsDeleted: Int!
            }

            type UpdateMachinesMutationResponse {
              info: UpdateInfo!
              machines: [Machine!]!
            }"
        `);
    });
});
