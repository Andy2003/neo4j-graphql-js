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

import type { UniqueType } from "../../utils/graphql-types";
import { TestHelper } from "../utils/tests-helper";

describe("https://github.com/neo4j/graphql/issues/1817", () => {
    const testHelper = new TestHelper();

    let TypeContainerType: UniqueType;
    let TypeContainer: UniqueType;
    let TypeMaterial: UniqueType;

    beforeAll(async () => {
        TypeContainerType = testHelper.createUniqueType("ContainerType");
        TypeContainer = testHelper.createUniqueType("Container");
        TypeMaterial = testHelper.createUniqueType("Material");

        const typeDefs = `
            type ${TypeContainerType} {
                id: ID! @id @unique
                name: String!
                specifiesContainers: [${TypeContainer}!]!
                    @relationship(type: "hasContainer", properties: "CoT_Co_hasContainer", direction: OUT)
            }
    
            type ${TypeContainer} {
                id: ID! @id @unique
                name: String
                containsMaterial: [${TypeMaterial}!]!
                    @relationship(type: "hasMaterial", properties: "Co_Ma_hasMaterial", direction: OUT)
            }
    
            type ${TypeMaterial} {
                id: ID! @id @unique
                name: String
            }
    
            type CoT_Co_hasContainer @relationshipProperties {
                id: ID! @id 
            }
    
            type Co_Ma_hasMaterial @relationshipProperties {
                id: ID! @id 
            }
        `;
        await testHelper.initNeo4jGraphQL({
            typeDefs,
        });
    });

    afterAll(async () => {
        await testHelper.close();
    });

    test("Using alias for an autogenerated connection should not fail", async () => {
        const query = `
            {
                ${TypeContainerType.plural}{
                  specifiesContainers {
                    AliasNestedLevel2: containsMaterialConnection {
                      edges {
                        node {
                          id
                        }
                      }
                    }
                  }
                }
              }
            `;

        const res = await testHelper.executeGraphQL(query);

        expect(res.errors).toBeUndefined();

        expect(res.data).toEqual({
            [TypeContainerType.plural]: [],
        });
    });
});
