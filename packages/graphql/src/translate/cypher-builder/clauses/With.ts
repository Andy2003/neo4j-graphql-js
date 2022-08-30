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

import type { CypherEnvironment } from "../Environment";
import { Projection } from "./sub-clauses/Projection";
import type { Expr } from "../types";
import { compileCypherIfExists } from "../utils/utils";
import type { Literal } from "../variables/Literal";
import type { Variable } from "../variables/Variable";
import { Clause } from "./Clause";
import { WithOrder } from "./mixins/WithOrder";
import { WithReturn } from "./mixins/WithReturn";
import { applyMixins } from "./utils/apply-mixin";

// With requires an alias for expressions that are not variables
export type WithProjection = Variable | [Expr, string | Variable | Literal];

export class With extends Clause {
    private projection: Projection;
    private isDistinct = false;

    constructor(...columns: Array<"*" | WithProjection>) {
        super();
        this.projection = new Projection(columns);
    }

    public addColumns(...columns: Array<"*" | WithProjection>): this {
        this.projection.addColumns(columns);
        return this;
    }

    public distinct(): this {
        this.isDistinct = true;
        return this;
    }

    public getCypher(env: CypherEnvironment): string {
        const projectionStr = this.projection.getCypher(env);
        const orderByStr = compileCypherIfExists(this.orderByStatement, env, { prefix: "\n" });
        const returnStr = compileCypherIfExists(this.returnStatement, env, { prefix: "\n" });
        const distinctStr = this.isDistinct ? " DISTINCT" : "";

        return `WITH${distinctStr} ${projectionStr}${orderByStr}${returnStr}`;
    }
}

export interface With extends WithOrder, WithReturn {}

applyMixins(With, [WithOrder, WithReturn]);
