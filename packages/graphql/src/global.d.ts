import type { TypeSource } from "@graphql-tools/utils";
import type { DocumentNode } from "graphql";
import type { IncomingMessage } from "http";
import { Neo4jGraphQLPlugins } from "./types";

interface SchemaDebug {
    inputSchema: TypeSource;
    augmentedSchema: string | null;
    config: {
        enableRegex?: boolean;
    };
    plugins?: Neo4jGraphQLPlugins;
}

interface TestDebug {
    query: DocumentNode;
    options: {
        req?: IncomingMessage;
        variableValues?: Record<string, any>;
    };
    cypher: string;
    cypherParams: Record<string, any>;
}

declare global {
    namespace NodeJS {
        interface Global {
            lastSchema?: SchemaDebug;
            testDebug: TestDebug[];
        }
    }
}
