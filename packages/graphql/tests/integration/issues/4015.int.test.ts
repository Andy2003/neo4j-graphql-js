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

import { gql } from "graphql-tag";
import { generate } from "randomstring";
import type { UniqueType } from "../../utils/graphql-types";
import { TestHelper } from "../../utils/tests-helper";

describe("https://github.com/neo4j/graphql/issues/4007", () => {
    const testHelper = new TestHelper();

    let typeMovie: UniqueType;
    let typeActor: UniqueType;

    beforeAll(() => {
        typeMovie = testHelper.createUniqueType("Movie");
        typeActor = testHelper.createUniqueType("Actor");
    });

    afterAll(async () => {
        await testHelper.close();
    });

    test("should return all the selected node fields", async () => {
        const typeDefs = gql`
            type ${typeMovie.name} {
                title: String!
                actors: [${typeActor.name}!]! @relationship(type: "ACTED_IN", direction: IN)
            }

            type ${typeActor.name} {
                name: String!
                surname: String
                movies: [${typeMovie.name}!]! @relationship(type: "ACTED_IN", direction: OUT)
            }
        `;

        await testHelper.initNeo4jGraphQL({ typeDefs });

        const movieTitle = generate({
            charset: "alphabetic",
        });

        const query = `
            {
                ${typeMovie.plural} {
                    actorsConnection {
                        edges {
                            node {
                                surname
                            }
                            no: node {
                                name
                            }
                        }
                    }
                }
            }
        `;

        await testHelper.executeCypher(
            `
                    CREATE (m:${typeMovie.name} {title: $movieTitle})
                    CREATE (m)<-[:ACTED_IN]-(:${typeActor.name} {name: "name1", surname: "surname1"})
                    CREATE (m)<-[:ACTED_IN]-(:${typeActor.name} {name: "name2", surname: "surname2"})
                    CREATE (m)<-[:ACTED_IN]-(:${typeActor.name} {name: "name3", surname: "surname3"})
                `,
            {
                movieTitle,
            }
        );

        const result = await testHelper.executeGraphQL(query);

        expect(result.errors).toBeUndefined();

        expect((result.data as any)[typeMovie.plural][0].actorsConnection.edges[0].no.name).toBeDefined();
        expect((result.data as any)[typeMovie.plural][0].actorsConnection.edges[0].node.surname).toBeDefined();
    });
});
