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

import { Neo4jGraphQL } from "../../../src";
import { createBearerToken } from "../../utils/create-bearer-token";
import { formatCypher, formatParams, translateQuery } from "../utils/tck-test-utils";

describe("https://github.com/neo4j/graphql/issues/5066", () => {
    let typeDefs: string;
    let neoSchema: Neo4jGraphQL;
    const secret = "secret";

    beforeAll(() => {
        typeDefs = /* GraphQL */ `
            type AdminGroup
                @node(labels: ["AdminGroup"])
                @mutation(operations: [])
                @authorization(filter: [{ where: { node: { createdBy: { id: "$jwt.sub" } } } }]) {
                id: ID! @id @unique
                createdAt: DateTime! @timestamp(operations: [CREATE]) @private
                updatedAt: DateTime! @timestamp(operations: [CREATE, UPDATE]) @private
                createdBy: User!
                    @relationship(type: "CREATED_ADMIN_GROUP", direction: IN)
                    @settable(onCreate: true, onUpdate: false)
            }

            type User
                @node(labels: ["User"])
                @mutation(operations: [])
                @authorization(
                    filter: [{ where: { node: { NOT: { blockedUsers_SOME: { to: { id: "$jwt.sub" } } } } } }]
                ) {
                id: ID! @unique @settable(onCreate: true, onUpdate: false)
                createdAt: DateTime! @private
                updatedAt: DateTime! @timestamp(operations: [CREATE, UPDATE]) @private
                username: String! @unique
                blockedUsers: [UserBlockedUser!]! @relationship(type: "HAS_BLOCKED", direction: OUT)
                createdAdminGroups: [AdminGroup!]! @relationship(type: "CREATED_ADMIN_GROUP", direction: OUT)
            }

            type UserBlockedUser
                @node(labels: ["UserBlockedUser"])
                @query(read: false, aggregate: false)
                @mutation(operations: [])
                @authorization(filter: [{ where: { node: { from: { id: "$jwt.sub" } } } }]) {
                id: ID! @id @unique
                createdAt: DateTime! @timestamp(operations: [CREATE]) @private
                updatedAt: DateTime! @timestamp(operations: [CREATE, UPDATE]) @private
                from: User! @relationship(type: "HAS_BLOCKED", direction: IN) @settable(onCreate: true, onUpdate: false)
                to: User! @relationship(type: "IS_BLOCKING", direction: OUT) @settable(onCreate: true, onUpdate: false)
            }

            union PartyCreator = User | AdminGroup

            type Party
                @node(labels: ["Party"])
                @mutation(operations: [])
                @authorization(
                    filter: [
                        { where: { node: { createdByConnection: { User: { node: { id: "$jwt.sub" } } } } } }
                        {
                            where: {
                                node: {
                                    createdByConnection: { AdminGroup: { node: { createdBy: { id: "$jwt.sub" } } } }
                                }
                            }
                        }
                    ]
                ) {
                id: ID! @id @unique
                createdAt: DateTime! @timestamp(operations: [CREATE]) @private
                updatedAt: DateTime! @timestamp(operations: [CREATE, UPDATE]) @private
                createdBy: PartyCreator!
                    @relationship(type: "CREATED_PARTY", direction: IN)
                    @settable(onCreate: true, onUpdate: false)
            }
        `;

        neoSchema = new Neo4jGraphQL({
            typeDefs,
            features: {
                authorization: {
                    key: secret,
                },
            },
        });
    });

    test("filter unions with authotization", async () => {
        const query = /* GraphQL */ `
            query Parties {
                parties {
                    id
                    createdBy {
                        ... on User {
                            username
                        }
                    }
                }
            }
        `;

        const token = createBearerToken(secret, { sub: "1" });
        const result = await translateQuery(neoSchema, query, {
            contextValues: {
                token,
            },
        });

        expect(formatCypher(result.cypher)).toMatchInlineSnapshot(`
            "MATCH (this:Party)
            CALL {
                WITH this
                MATCH (this)<-[this0:CREATED_PARTY]-(this1:AdminGroup)
                OPTIONAL MATCH (this1)<-[:CREATED_ADMIN_GROUP]-(this2:User)
                WITH *, count(this2) AS createdByCount
                WITH *
                WHERE (createdByCount <> 0 AND ($jwt.sub IS NOT NULL AND this2.id = $jwt.sub))
                RETURN count(this1) > 0 AS var3
            }
            WITH *
            WHERE (($isAuthenticated = true AND single(this4 IN [(this)<-[this5:CREATED_PARTY]-(this4:User) WHERE ($jwt.sub IS NOT NULL AND this4.id = $jwt.sub) | 1] WHERE true)) OR ($isAuthenticated = true AND var3 = true))
            CALL {
                WITH this
                CALL {
                    WITH *
                    MATCH (this)<-[this6:CREATED_PARTY]-(this7:AdminGroup)
                    OPTIONAL MATCH (this7)<-[:CREATED_ADMIN_GROUP]-(this8:User)
                    WITH *, count(this8) AS createdByCount
                    WITH *
                    WHERE ($isAuthenticated = true AND (createdByCount <> 0 AND ($jwt.sub IS NOT NULL AND this8.id = $jwt.sub)))
                    WITH this7 { __resolveType: \\"AdminGroup\\", __id: id(this7) } AS this7
                    RETURN this7 AS var9
                    UNION
                    WITH *
                    MATCH (this)<-[this10:CREATED_PARTY]-(this11:User)
                    CALL {
                        WITH this11
                        MATCH (this11)-[:HAS_BLOCKED]->(this12:UserBlockedUser)
                        OPTIONAL MATCH (this12)-[:IS_BLOCKING]->(this13:User)
                        WITH *, count(this13) AS toCount
                        WITH *
                        WHERE (toCount <> 0 AND ($jwt.sub IS NOT NULL AND this13.id = $jwt.sub))
                        RETURN count(this12) > 0 AS var14
                    }
                    WITH *
                    WHERE ($isAuthenticated = true AND NOT (var14 = true))
                    WITH this11 { .username, __resolveType: \\"User\\", __id: id(this11) } AS this11
                    RETURN this11 AS var9
                }
                WITH var9
                RETURN head(collect(var9)) AS var9
            }
            RETURN this { .id, createdBy: var9 } AS this"
        `);

        expect(formatParams(result.params)).toMatchInlineSnapshot(`
            "{
                \\"jwt\\": {
                    \\"roles\\": [],
                    \\"sub\\": \\"1\\"
                },
                \\"isAuthenticated\\": true
            }"
        `);
    });
});
