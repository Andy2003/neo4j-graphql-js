import { ArgumentNode, type ASTNode, print, visit } from "graphql";
import * as fs from "fs";
import * as path from "path";
import NodeEnvironment from "jest-environment-node";
import neo4j from "neo4j-driver";
import neo4jDriver from "neo4j-driver";
import type { TypeSource } from "@graphql-tools/utils/typings";
import { parse } from "graphql/language/parser";
import {
    CypherQuery,
    DebugGraphQLRequest,
    MyEnvironmentContext,
    NestedScalarTypes,
    ResolvedScalarTypes,
    TestDebug,
} from "./my-global";
import type { ExecutionResult } from "graphql/execution/execute";
import type { EnvironmentContext, JestEnvironmentConfig } from "@jest/environment";
import type { Circus } from "@jest/types";

const beginNoString = "~begin~no~string~";
const endNoString = "~end~no~string~";
const noStringPattern = new RegExp(`"${beginNoString}(.+?)${endNoString}"`, "g");

class TestSet {
    readonly name: string | null;
    readonly setup: {
        schema?: string;
        schemaConfig?: string;
        testData?: string;
    } = {};
    nestedSets: TestSet[] = [];
    readonly parent: TestSet | null;
    tests: BaseTest[] = [];

    constructor(name: string | null, parent: TestSet | null = null) {
        this.name = name;
        this.parent = parent;
        if (parent) {
            parent.nestedSets.push(this);
        }
    }

    hasTests() {
        return this.tests.length > 0 || this.nestedSets.some((nested) => nested.hasTests());
    }

    hasSetup() {
        return Object.values(this.setup).filter(Boolean).length > 0;
    }

    harmonizeSetup() {
        const [first, ...others] = this.nestedSets;
        if (first && others.length) {
            const moveUp = (name: keyof TestSet["setup"]) => {
                const value = first.setup[name];
                if (value && others.every(({ setup }) => setup[name] === value)) {
                    this.setup[name] = value;
                    this.nestedSets.forEach(({ setup }) => (setup[name] = undefined));
                    return true;
                }
                return false;
            };
            if (moveUp("schema")) {
                moveUp("schemaConfig");
                moveUp("testData");
            }
        }
    }

    removeSchemaTests() {
        this.tests = this.tests.filter((test) => !(test instanceof SchemaTest));
        this.nestedSets.forEach((nested) => nested.removeSchemaTests());
    }
}

interface BaseTest {}

class SchemaTest implements BaseTest {
    augmentedSchema: string;

    constructor(augmentedSchema: string) {
        this.augmentedSchema = augmentedSchema;
    }
}

class CypherTest implements BaseTest, TestDebug {
    cypherRequest?: CypherQuery;
    graphqlRequest?: DebugGraphQLRequest;
    response?: ExecutionResult;
    resolvedScalarTypes?: ResolvedScalarTypes;

    constructor(data: TestDebug) {
        this.cypherRequest = data.cypherRequest;
        this.graphqlRequest = data.graphqlRequest;
        this.response = data.response;
        this.resolvedScalarTypes = data.resolvedScalarTypes;
    }
}

class CustomEnvironment extends NodeEnvironment {
    private describeBlockToTestSet = new Map<Circus.DescribeBlock, TestSet>();
    private current: TestSet | null = null;
    private rootTestSet: TestSet | null = null;

    // @ts-ignore
    global: NodeEnvironment["global"] & {
        customEnvironmentContext: MyEnvironmentContext;
    };

    constructor(config: JestEnvironmentConfig, context: EnvironmentContext) {
        super(config, context);
    }

    handleTestEvent = async (event: Circus.AsyncEvent) => {
        // console.log("event", event.name);

        if (event.name === "run_describe_start") {
            const describeBlock = event.describeBlock;
            let isRoot = describeBlock.name === "ROOT_DESCRIBE_BLOCK";
            const testSet = new TestSet(isRoot ? null : describeBlock.name, this.current);
            this.describeBlockToTestSet.set(describeBlock, testSet);
            if (isRoot) {
                this.rootTestSet = testSet;
            }
            this.current = testSet;
        }
        if (event.name === "test_fn_start") {
            this.current = new TestSet(event.test.name, this.current);
        }

        if (["run_describe_finish", "test_done"].includes(event.name) && this.current) {
            this.current.harmonizeSetup();
            this.current = this.current.parent;
        }

        if (["test_fn_success", "hook_success"].includes(event.name) && this.current) {
            const ctx = this.global.customEnvironmentContext;
            if (ctx?.lastSchema?.inputSchema) {
                this.current.setup.schema = CustomEnvironment.printGraphQL(ctx.lastSchema.inputSchema);
            }
            if (ctx?.lastSchema?.config) {
                let schemaConfig = JSON.stringify(ctx.lastSchema.config, null, 2);
                if (schemaConfig !== "{}") {
                    this.current.setup.schemaConfig = schemaConfig;
                }
            }
            let cypherQueries = ctx?.additionalCypherQueries?.filter(({ beforeRequest }) => beforeRequest);
            if (cypherQueries?.length) {
                this.current.setup.testData = cypherQueries
                    .map(({ cypher, cypherParams }) =>
                        this.replaceParamsInCypher(cypher.trim().replace(/ +/g, " "), cypherParams)
                    )
                    .join(";\n");
            }
        }

        if (event.name === "test_fn_success" && this.current) {
            const ctx = this.global.customEnvironmentContext;
            let hasGraphQLRequest = false;
            ctx?.testDebug.forEach((value) => {
                if (value.graphqlRequest && this.current) {
                    hasGraphQLRequest = true;
                    this.current.tests.push(new CypherTest(value));
                }
            });
            if (!hasGraphQLRequest && ctx?.lastSchema?.augmentedSchema) {
                this.current.tests.push(new SchemaTest(ctx.lastSchema.augmentedSchema));
            }
        }

        if (["test_done", "setup", "hook_success"].includes(event.name)) {
            this.global.customEnvironmentContext = {
                beforeRequest: true,
                lastSchema: undefined,
                testDebug: [],
                additionalCypherQueries: [],
            };
        }

        if (event.name === "run_finish" && this.rootTestSet) {
            await this.writeTestFile(this.rootTestSet);
        }
    };

    private toCypherValue(params: object): string {
        const convert = (obj: any): string => {
            if (typeof obj !== "object" || obj === null) {
                return JSON.stringify(obj);
            }

            if (Array.isArray(obj)) {
                return `[${obj.map(convert).join(", ")}]`;
            }

            const conv = this.handleCypherTypes(obj);
            if (conv !== undefined) {
                return conv;
            }

            const entries = Object.entries(obj).map(([key, value]) => {
                const cypherValue = this.handleCypherTypes(value);
                if (cypherValue !== undefined) {
                    return `${key}: ${cypherValue}`;
                }
                return `${key}: ${convert(value)}`;
            });

            return `{${entries.join(", ")}}`;
        };

        return convert(params);
    }

    private handleCypherTypes(value: any) {
        if (neo4jDriver.isDate(value)) {
            return `date("${value.toString()}")`;
        } else if (neo4jDriver.isDuration(value)) {
            return `duration("${value.toString()}")`;
        } else if (neo4jDriver.isDateTime(value)) {
            return `datetime("${value.toString()}")`;
        } else if (neo4jDriver.isTime(value)) {
            return `time("${value.toString()}")`;
        } else if (neo4jDriver.isLocalDateTime(value)) {
            return `localdatetime("${value.toString()}")`;
        } else if (neo4jDriver.isLocalTime(value)) {
            return `localtime("${value.toString()}")`;
        } else if (neo4jDriver.isPoint(value)) {
            return `point(${this.toCypherValue(value)})`;
        }
        return undefined;
    }

    private getCypherParamValue(path: string[], params: object, index = 0): string {
        if (index === path.length) {
            return this.toCypherValue(params);
        }
        const key = path[index];
        if (key && key in params) {
            return this.getCypherParamValue(path, params[key], index + 1);
        }
        return "null";
    }

    private replaceParamsInCypher(cypher: string, params: object): string {
        return cypher.replace(/\$([a-zA-Z][\w.]*)/g, (_, match) => {
            return this.getCypherParamValue(match.split("."), params);
        });
    }

    private async writeTestFile(testSet: TestSet) {
        if (
            testSet.name === null &&
            testSet.nestedSets.length == 1 &&
            testSet.tests.length == 0 &&
            !testSet.hasSetup()
        ) {
            await this.writeTestFile(testSet.nestedSets[0]!);
            return;
        }

        const testPath: string = (this.global.expect as any).getState().testPath;

        let targetPath: string | undefined;
        let skipSchemaTest = false;

        const basePath = "/neo4j-graphql/packages/graphql/tests";
        const targetBasePath = path.join(__dirname, "../../..", "neo4j-graphql-java2/core/src/test/resources");

        if (testPath.includes(`${basePath}/schema`)) {
            const fileName = testPath.replace(/.*\/schema\/(.*).test.ts/, "$1");
            targetPath = path.join(targetBasePath, `tck-test-files/schema/v2/${fileName}.js.adoc`);
        } else if (testPath.includes(`${basePath}/tck`)) {
            const fileName = testPath.replace(/.*\/tck\/(.*).test.ts/, "$1");
            targetPath = path.join(targetBasePath, `tck-test-files/cypher/v2/${fileName}.js.adoc`);
            skipSchemaTest = true;
        } else if (testPath.includes(`${basePath}/integration`)) {
            const fileName = testPath.replace(/.*\/integration\/(.*?)(\.int)?.test.ts/, "$1");
            targetPath = path.join(targetBasePath, `integration-test-files/${fileName}.js.adoc`);
            skipSchemaTest = true;
        }
        if (skipSchemaTest) {
            testSet.removeSchemaTests();
        }
        if (!testSet.hasTests()) {
            return;
        }

        if (targetPath) {
            let str = `// This file was generated by the Test-Case extractor of neo4j-graphql\n:toc:\n:toclevels: 42\n`;

            str += CustomEnvironment.getAllTestDocs(testSet, 1);

            fs.mkdirSync(path.dirname(targetPath), { recursive: true });
            fs.writeFileSync(targetPath, str);
        }
    }

    private static printGraphQL(schema: TypeSource) {
        let ast: ASTNode;
        if (typeof schema === "string") {
            ast = parse(schema);
        } else {
            ast = schema as ASTNode;
        }
        ast = visit(ast, {
            Directive(node) {
                const directivesToFilter = {
                    filterable: "byAggregate",
                    selectable: "onAggregate",
                    query: "aggregate",
                    relationship: "aggregate",
                };
                return {
                    ...node,
                    arguments: node.arguments?.filter(
                        (arg: ArgumentNode) => arg.name.value !== directivesToFilter[node.name.value]
                    ),
                };
            },
        });
        return print(ast);
    }

    private static getAllTestDocs(testSet: TestSet, level: number = 1) {
        let result = "";
        if (testSet.name) {
            result += `\n${CustomEnvironment.headlineLevel(level)}${testSet.name}\n`;
        }

        if (testSet.hasSetup()) {
            if (testSet.nestedSets.length) {
                result += `\n${CustomEnvironment.headlineLevel(level + 1)}Setup\n`;
            }

            if (testSet.setup.schema) {
                result += `\n.Schema\n[source,graphql,schema=true]\n----\n${testSet.setup.schema}\n----\n`;
            }
            if (testSet.setup.schemaConfig) {
                result += `\n.Configuration\n[source,json,schema-config=true]\n----\n${testSet.setup.schemaConfig}\n----\n`;
            }
            if (testSet.setup.testData) {
                result += `\n.Test Data\n[source,cypher,test-data=true]\n----\n${testSet.setup.testData}\n----\n`;
            }

            if (testSet.nestedSets.length && testSet.tests.length) {
                result += "\n" + CustomEnvironment.headlineLevel(level + 1) + "Tests\n\n";
            }
        }

        result += testSet.tests.map((test) => CustomEnvironment.getSingleTestDoc(test)).join(`\n'''\n`);
        for (const testSet1 of testSet.nestedSets) {
            if (testSet1.hasTests()) {
                result += CustomEnvironment.getAllTestDocs(testSet1, level + 1);
            }
        }
        return result;
    }

    private static getSingleTestDoc(test: BaseTest) {
        let result = "";

        if (test instanceof SchemaTest) {
            result += `\n.Augmented Schema\n[source,graphql,augmented=true]\n----\n${test.augmentedSchema}\n----\n`;
        } else if (test instanceof CypherTest) {
            const { cypherRequest, graphqlRequest, response, resolvedScalarTypes } = test;

            if (graphqlRequest) {
                const request = CustomEnvironment.printGraphQL(graphqlRequest.query);
                result += `\n.GraphQL-Query\n[source,graphql,request=true]\n----\n${request}\n----\n`;

                if (
                    graphqlRequest.options?.variableValues &&
                    Object.keys(graphqlRequest.options?.variableValues).length
                ) {
                    const requestParamsJson = JSON.stringify(graphqlRequest.options.variableValues, null, 2);
                    result += `\n.GraphQL params input\n[source,json,request=true]\n----\n${requestParamsJson}\n----\n`;
                }
            }

            // const contextValue = { token: test.options?.token, ...test.options?.contextValues };
            // if (contextValue.token && testSet.schema.features?.authorization) {
            //     const jwt = await new Neo4jGraphQLAuthorization(testSet.schema.features?.authorization).decode(
            //         contextValue
            //     );
            //     const auth = {
            //         isAuthenticated: true,
            //         ...(jwt?.roles ? { roles: jwt.roles } : {}),
            //         jwt,
            //     };
            //     if (jwt && Object.keys(jwt).length) {
            //         const jwtJson = JSON.stringify({ auth }, null, 2);
            //         result += `.Query Context\n[source,json,query-config=true]\n----\n${jwtJson}\n----\n\n`;
            //     }
            // }

            if (cypherRequest) {
                let cypherParamsJson = JSON.stringify(
                    cypherRequest.cypherParams,
                    (key, value) => {
                        if (neo4j.isInt(value)) {
                            if (neo4j.integer.inSafeRange(value)) {
                                return value.toNumber();
                            } else {
                                return beginNoString + value.toString() + endNoString;
                            }
                        }
                        if (
                            neo4j.isDuration(value) ||
                            neo4j.isDate(value) ||
                            neo4j.isDateTime(value) ||
                            neo4j.isLocalDateTime(value) ||
                            neo4j.isLocalTime(value) ||
                            neo4j.isTime(value)
                        ) {
                            return value.toString();
                        }
                        if (key === "resolvedCallbacks" && Object.keys(value).length === 0) {
                            return undefined;
                        }
                        return value;
                    },
                    2
                );
                cypherParamsJson = cypherParamsJson.replace(noStringPattern, "$1");
                result += `\n.Expected Cypher params\n[source,json]\n----\n${cypherParamsJson}\n----\n\n`;
                let cypher = cypherRequest.cypher

                    // TODO cypher adjustments

                    .replace(/__resolveType/g, "__typename")
                    .replace(/ (id\([^)]+\))/g, " toString($1)");
                result += `.Expected Cypher output\n[source,cypher]\n----\n${cypher}\n----\n`;
            }

            if (response?.data) {
                let json = this.stringify(response, resolvedScalarTypes);
                result += `\n.GraphQL-Response\n[source,json,response=true]\n----\n${json}\n----\n`;
            }
        }
        return result;
    }

    private static stringify(response: ExecutionResult, resolvedScalarTypes: ResolvedScalarTypes | undefined) {
        const replace = (value: unknown, types: NestedScalarTypes | undefined) => {
            if (typeof value === "object" && value !== null) {
                if (Array.isArray(value)) {
                    return value.map((v) => replace(v, types));
                }
                const result: Record<string, any> = {};
                for (const [key, v] of Object.entries(value)) {
                    result[key] = replace(v, types?.[key]);
                }
                return result;
            }
            if (typeof value === "number" && !isNaN(value) && types === "Float") {
                const str = `${value}`;
                return beginNoString + (str.includes(".") ? str : `${str}.0`) + endNoString;
            }
            return value;
        };
        const data = replace(response.data, resolvedScalarTypes);

        let json = JSON.stringify(data, null, 2);
        return json.replace(noStringPattern, "$1");
    }

    private static headlineLevel(level: number) {
        let result = "";
        for (let i = 0; i < level; i++) {
            result += "=";
        }
        return result + " ";
    }
}

module.exports = CustomEnvironment;
