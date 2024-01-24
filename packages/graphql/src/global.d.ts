import type { TypeSource } from "@graphql-tools/utils";
import type { DocumentNode } from "graphql";
import type { Neo4jFeaturesSettings } from "./types";

interface SchemaDebug {
    inputSchema: TypeSource;
    augmentedSchema: string | null;
    features?: Neo4jFeaturesSettings;
    config?: {
        features?: Neo4jFeaturesSettings;
        experimental?: boolean;
    };
}

interface TestDebug {
    query: DocumentNode;
    options: {
        token?: string;
        variableValues?: Record<string, any>;
        neo4jVersion?: string;
        contextValues?: Record<string, any>;
        subgraph?: boolean;
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
