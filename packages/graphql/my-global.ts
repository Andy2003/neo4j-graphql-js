// eslint-disable-next-line eslint-comments/disable-enable-pair
/* eslint-disable no-var */
import type { TypeSource } from "@graphql-tools/utils";
import type { GraphQLArgs } from "graphql/index";
import type { ExecutionResult } from "graphql/execution/execute";
import type { Neo4jFeaturesSettings } from "./src/types";

export interface SchemaDebug {
    inputSchema: TypeSource;
    augmentedSchema: string | null;
    features?: Neo4jFeaturesSettings;
    config?: {
        features?: Neo4jFeaturesSettings;
        experimental?: boolean;
    };
}

export type CypherQuery = {
    cypher: string;
    cypherParams: Record<string, any>;
    beforeRequest: boolean;
};

export type DebugGraphQLRequest = {
    query: TypeSource;
    options?: Partial<Pick<GraphQLArgs, "variableValues" | "contextValue" | "schema">> & {
        token?: string;
        neo4jVersion?: string;
        subgraph?: boolean;
    };
};


export type NestedScalarTypes = { [pathElement: string]: NestedScalarTypes } | string;
export type ResolvedScalarTypes ={ [pathElement: string]: NestedScalarTypes }

export interface TestDebug {
    cypherRequest?: CypherQuery;
    graphqlRequest?: DebugGraphQLRequest;
    response?: ExecutionResult;
    resolvedScalarTypes?: ResolvedScalarTypes;
}

export interface MyEnvironmentContext {
    lastSchema: SchemaDebug | undefined;
    testDebug: TestDebug[];
    beforeRequest: boolean;
    additionalCypherQueries: CypherQuery[];
}

declare global {
    var customEnvironmentContext: MyEnvironmentContext;
}
