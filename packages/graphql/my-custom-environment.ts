import { type ASTNode, print } from "graphql";
import * as fs from "fs";
import * as path from "path";
import type { DescribeBlock, TestEntry } from "@jest/types/build/Circus";
import type { SchemaDebug, TestDebug } from "./src/global";
import NodeEnvironment from "jest-environment-node";
import neo4j from "neo4j-driver";
import { getToken } from "./src/utils/get-token";
import type { JwtPayload } from "./src/types";
import type { TypeSource } from "@graphql-tools/utils/typings";
import { parse } from "graphql/language/parser";

type ExtendedTest = TestEntry & {
    debugData?: {
        schema: SchemaDebug;
        requests: TestDebug[];
    };
};

class TestSet {
    schema: SchemaDebug;
    hasCypherTest: boolean;
    name: string;
    nestedSets: TestSet[] = [];
    parent?: TestSet;
    tests: BaseTest[] = [];

    constructor(schema: SchemaDebug, name: string, hasCypherTest: boolean) {
        this.schema = schema;
        this.name = name;
        this.hasCypherTest = hasCypherTest;
    }

    public getNameParts(): string[] {
        if (this.parent == null) {
            return [];
        }
        let strings = [...this.parent.getNameParts(), this.name];
        if (!this.hasCypherTest && this.tests.length) {
            strings.push(this.tests[0].name);
        }
        return strings;
    }

    public getName(skipLevel: number, delimiter: string, filterDuplicates = false): string {
        let parts = this.getNameParts().slice(skipLevel);
        if (filterDuplicates) {
            let last: string | null = null;
            parts = parts.filter((value) => {
                const f = value !== last;
                last = value;
                return f;
            });
        }
        return parts.join(delimiter);
    }
}

class BaseTest {
    name: string;

    constructor(name: string) {
        this.name = name;
    }
}

class CypherTest extends BaseTest implements TestDebug {
    query;
    options;
    cypher;
    cypherParams;

    constructor(data: TestDebug, name: string) {
        super(name);
        this.query = data.query;
        this.options = data.options;
        this.cypher = data.cypher;
        this.cypherParams = data.cypherParams;
    }
}

class CustomEnvironment extends NodeEnvironment {
    private testPath: string;
    private docblockPragmas: Record<string, string | Array<string>>;

    constructor(config, context) {
        super(config, context);
        this.testPath = context.testPath;
        this.docblockPragmas = context.docblockPragmas;
    }

    // noinspection JSUnusedLocalSymbols
    async handleTestEvent(event, state) {
        const { name } = event;
        if (["test_start", "test_fn_start"].includes(name)) {
            this.global.testDebug = [];
        }
        if (event.name === "test_fn_success") {
            event.test.debugData = {
                requests: this.global.testDebug,
                schema: this.global.lastSchema,
            };
        }

        if (event.name === "run_describe_finish" && !event.describeBlock.parent) {
            await this.writeTestFiles(event.describeBlock);
        }
    }

    async writeTestFiles(describeBlock: DescribeBlock) {
        const testWithSameSchema = this.collectTestsWithSameSchema(describeBlock.children);

        const level = this.getCommonLevel(testWithSameSchema, 0);
        const deepestTests = testWithSameSchema.map((value) => CustomEnvironment.findDeepestTestSet(value));
        const names = deepestTests.map((value) =>
            value
                .getName(level, "/")
                .trim()
                .replace(/([^\w/]+)/g, "-")
                .toLowerCase()
        );
        const canUseNameAsSuffix = new Set(names).size === names.length;

        await Promise.all(
            deepestTests.map(async (testSet, index, array) => {
                let classifier: string | null = null;
                if (array.length > 1) {
                    classifier = "" + (canUseNameAsSuffix ? names[index] : index + 1);
                }
                if (testSet.hasCypherTest) {
                    await this.writeCypherTest(testSet, classifier);
                } else {
                    this.writeSchemaTest(testSet, classifier);
                }
            })
        );
    }

    private getCommonLevel(testSets: TestSet[], level: number) {
        const nextLevel: TestSet[] = [];
        const names = new Set();
        for (let i = 0; i < testSets.length; i++) {
            const testSet = testSets[i];
            nextLevel.push(...testSet.nestedSets);
            names.add(testSet.name);
            if (names.size > 1) {
                return level - 1;
            }
        }
        if (testSets.find((value) => value.tests.length)) {
            return level;
        }
        if (nextLevel.length) {
            return this.getCommonLevel(nextLevel, level + 1);
        }
        return level;
    }

    private static findDeepestTestSet(testSet: TestSet): TestSet {
        if (!testSet.tests.length && testSet.nestedSets?.length === 1) {
            return this.findDeepestTestSet(testSet?.nestedSets[0]);
        }
        return testSet;
    }

    private collectTestsWithSameSchema(children: Array<DescribeBlock | ExtendedTest>) {
        const result: TestSet[] = [];

        children.forEach((child) => {
            if (child.type === "describeBlock") {
                const childResults = this.collectTestsWithSameSchema(child.children);
                childResults.forEach((childResult) => {
                    let existingResult = result.find(
                        (value) => value.schema.inputSchema === childResult.schema.inputSchema
                    );
                    if (!existingResult) {
                        existingResult = new TestSet(childResult.schema, child.parent!.name, childResult.hasCypherTest);
                        result.push(existingResult);
                    }
                    childResult.parent = existingResult;
                    existingResult.nestedSets!.push(childResult);
                    existingResult.nestedSets!.sort((a, b) => a.name.localeCompare(b.name));
                });
            }
        });
        children.forEach((child) => {
            if (child.type === "test" && child.debugData) {
                let debugData = child.debugData!;
                if (!debugData.schema.augmentedSchema) {
                    // TODO handle error cases
                    return;
                }
                let existingResult = result.find((value) => value.schema.inputSchema === debugData.schema.inputSchema);
                if (!existingResult) {
                    existingResult = new TestSet(debugData.schema, child.parent.name, false);
                    result.push(existingResult);
                }
                if (debugData.requests?.length) {
                    existingResult.hasCypherTest = true;
                    debugData.requests.forEach((value, index, array) => {
                        existingResult!.tests.push(
                            new CypherTest(value, array.length > 1 ? child.name + " - " + (index + 1) : child.name)
                        );
                    });
                } else {
                    existingResult!.tests.push(new BaseTest(child.name));
                }
                existingResult.tests.sort((a, b) => a.name.localeCompare(b.name));
            }
        });
        result.sort((a, b) => a.name.localeCompare(b.name));
        return result;
    }

    private async writeCypherTest(testSet: TestSet, classifier: string | null) {
        let str = `:toc:\n\n= ${testSet.name}\n`;

        const sourceSchema = CustomEnvironment.printGraphQL(testSet.schema.inputSchema);
        str += `\n== Source schema\n\n[source,graphql,schema=true]\n----\n${sourceSchema}\n----\n`;

        const schemaConfig = JSON.stringify(testSet.schema.config, null, 2);
        str += `\n== Configuration\n\n.Configuration\n[source,json,schema-config=true]\n----\n${schemaConfig}\n----\n`;

        str += await CustomEnvironment.getAllTestDocs(testSet, 1, true);

        const testPath: string = (this.global.expect as any).getState().testPath;
        if (testPath.includes("/neo4j-graphql/packages/graphql/tests/tck")) {
            const fileName = testPath.replace(/.*\/neo4j-graphql\/packages\/graphql\/tests\/tck\/(.*).test.ts/, "$1");
            const targetPath = path.join(
                __dirname,
                "../../..",
                `neo4j-graphql-java2/core/src/test/resources/tck-test-files/cypher/v2/${fileName}${
                    classifier ? `_${classifier}` : ""
                }.adoc`
            );
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
        return print(ast);
    }

    private static async getAllTestDocs(testSet: TestSet, level: number = 1, skipHeadline: boolean) {
        let result = "";
        if (!skipHeadline) {
            result += (await CustomEnvironment.headlineLevel(level)) + testSet.name + "\n\n";
        }
        for (const test of testSet.tests) {
            result += (await CustomEnvironment.getSingleTestDoc(test as CypherTest, level + 1, testSet)) + "\n";
        }
        for (const testSet1 of testSet.nestedSets) {
            result += (await CustomEnvironment.getAllTestDocs(testSet1, level + 1, false)) + "\n";
        }
        return result;
    }

    private static async getSingleTestDoc(test: CypherTest, level: number = 1, testSet: TestSet) {
        let result = CustomEnvironment.headlineLevel(level) + test.name + "\n";
        const request = CustomEnvironment.printGraphQL(test.query);
        result += `\n.GraphQL-Query\n[source,graphql]\n----\n${request}\n----\n`;

        if (test.options?.variableValues && Object.keys(test.options?.variableValues).length) {
            const requestParamsJson = JSON.stringify(test.options.variableValues, null, 2);
            result += `\n.GraphQL params input\n[source,json,request=true]\n----\n${requestParamsJson}\n----\n`;
        }

        if (test.options?.req && testSet.schema.plugins?.auth) {
            const token = getToken(test.options?.req);

            if (token) {
                let jwt = await testSet.schema.plugins.auth.decode<JwtPayload>(token);
                if (jwt?.roles && !jwt?.roles?.length) {
                    delete jwt.roles;
                }
                if (jwt && Object.keys(jwt).length) {
                    const jwtJson = JSON.stringify({ contextParams: { jwt } }, null, 2);
                    result += `\n.Query Context\n[source,json,query-config=true]\n----\n${jwtJson}\n----\n`;
                }
            }
        }

        let cypherParamsJson = JSON.stringify(
            test.cypherParams,
            (key, value) => {
                if (neo4j.isInt(value)) {
                    if (neo4j.integer.inSafeRange(value)) {
                        return value.toNumber();
                    } else {
                        return value;
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
                return value;
            },
            2
        );
        result += `\n.Expected Cypher params\n[source,json]\n----\n${cypherParamsJson}\n----\n`;
        result += `\n.Expected Cypher output\n[source,cypher]\n----\n${test.cypher}\n----\n`;
        result += `\n'''\n`;
        return result;
    }

    private static headlineLevel(level: number) {
        let result = "";
        for (let i = 0; i < level; i++) {
            result += "=";
        }
        return result + " ";
    }

    private writeSchemaTest(testSet: TestSet, classifier: string | null) {
        let str = `:toc:\n\n= ${testSet.getName(0, " -> ", true)}\n`;

        const sourceSchema = CustomEnvironment.printGraphQL(testSet.schema.inputSchema);
        str += `\n== Source schema\n\n[source,graphql,schema=true]\n----\n${sourceSchema}\n----\n`;

        const schemaConfig = JSON.stringify(testSet.schema.config, null, 2);
        if (schemaConfig !== "{}") {
            str += `\n== Configuration\n\n.Configuration\n[source,json,schema-config=true]\n----\n${schemaConfig}\n----\n`;
        }

        const augmentedSchema = testSet.schema.augmentedSchema;
        str += `\n== Augmented schema\n\n.Augmented Schema\n[source,graphql]\n----\n${augmentedSchema}\n----\n`;
        str += `\n'''\n`;

        const testPath: string = (this.global.expect as any).getState().testPath;
        if (testPath.includes("/neo4j-graphql/packages/graphql/tests/schema")) {
            const fileName = testPath.replace(
                /.*\/neo4j-graphql\/packages\/graphql\/tests\/schema\/(.*).test.ts/,
                "$1"
            );
            const targetPath = path.join(
                __dirname,
                "../../..",
                `neo4j-graphql-java2/core/src/test/resources/tck-test-files/schema/v2/${fileName}${
                    classifier ? `/${classifier}` : ""
                }.adoc`
            );
            fs.mkdirSync(path.dirname(targetPath), { recursive: true });
            fs.writeFileSync(targetPath, str);
        }
    }
}

module.exports = CustomEnvironment;
