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

import Cypher from "@neo4j/cypher-builder";
import type { GraphElement, Node, Relationship } from "../classes";
import type { RelationField, Context, BaseField } from "../types";
import { aggregationFieldRegEx, AggregationFieldRegexGroups, whereRegEx } from "./where/utils";
import { createBaseOperation } from "./where/property-operations/create-comparison-operation";

type Operator = "=" | "<" | "<=" | ">" | ">=";

type logicalOperator = "AND" | "OR";

type WhereFilter = Record<string | logicalOperator, any>;

export type AggregateWhereInput = {
    count: number;
    count_LT: number;
    count_LTE: number;
    count_GT: number;
    count_GTE: number;
    node: WhereFilter;
    edge: WhereFilter;
} & WhereFilter;

type AggregateWhereReturn = {
    returnVariables: ("*" | Cypher.ProjectionColumn)[];
    predicates: Cypher.Predicate[];
};

const comparisonOperators = ["EQUAL", "GT", "GTE", "LT", "LTE"];
const aggregationOperators = ["SHORTEST", "LONGEST", "MIN", "MAX", "SUM"];
const countOperators = ["count", "count_LT", "count_LTE", "count_GT", "count_GTE"];
const logicalOperators = ["AND", "OR"];
const entities = ["node", "edge"];

// Reducer function that merge an array of AggregateWhereReturn into a single AggregateWhereReturn
function aggregateWhereReducer(accumulator: AggregateWhereReturn, current: AggregateWhereReturn) {
    return {
        returnVariables: [...accumulator.returnVariables, ...(current?.returnVariables || [])],
        predicates: [...accumulator.predicates, ...(current?.predicates || [])],
    };
}

export function aggregateWhere(
    aggregateWhereInput: AggregateWhereInput,
    refNode: Node,
    aggregationTarget: Cypher.Node,
    cypherRelation: Cypher.Relationship
): AggregateWhereReturn {
    return Object.entries(aggregateWhereInput)
        .map(([key, value]): AggregateWhereReturn => {
            if (countOperators.includes(key)) {
                const paramName = new Cypher.Param(value);
                const count = Cypher.count(aggregationTarget);
                const operator = whereRegEx.exec(key)?.groups?.operator || "EQ";
                const operation = createBaseOperation({
                    operator,
                    property: count,
                    param: paramName,
                });
                const operationVar = new Cypher.Variable();
                return {
                    returnVariables: [[operation, operationVar]],
                    predicates: [Cypher.eq(operationVar, new Cypher.Param(true))],
                };
            } else if (entities.includes(key)) {
                const target = key === "edge" ? cypherRelation : aggregationTarget;
                return aggregateEntityWhere(value, refNode, target);
            } else if (logicalOperators.includes(key)) {
                const logicalOperator = key === "AND" ? Cypher.and : Cypher.or;
                const { returnVariables, predicates } = value
                    .map((whereInput) => {
                        return aggregateWhere(whereInput, refNode, aggregationTarget, cypherRelation);
                    })
                    .reduce(aggregateWhereReducer, {
                        returnVariables: [],
                        predicates: [],
                    });

                return {
                    returnVariables,
                    predicates: [logicalOperator(...predicates)],
                };
            }
            return {
                returnVariables: [],
                predicates: [],
            };
        })
        .reduce(aggregateWhereReducer, {
            returnVariables: [],
            predicates: [],
        });
}

function aggregateEntityWhere(
    aggregateEntityWhereInput: WhereFilter,
    refNode: Node,
    target: Cypher.Node | Cypher.Relationship
): AggregateWhereReturn {
    return Object.entries(aggregateEntityWhereInput)
        .map(([key, value]): AggregateWhereReturn => {
            if (logicalOperators.includes(key)) {
                const logicalOperator = key === "AND" ? Cypher.and : Cypher.or;
                const { returnVariables, predicates } = value
                    .map((whereInput) => {
                        return aggregateEntityWhere(whereInput, refNode, target);
                    })
                    .reduce(aggregateWhereReducer, {
                        returnVariables: [],
                        predicates: [],
                    });
                return {
                    returnVariables,
                    predicates: [logicalOperator(...predicates)],
                };
            } else {
                const paramName = new Cypher.Param(value);
                const regexResult = aggregationFieldRegEx.exec(key)?.groups as AggregationFieldRegexGroups;
                const { logicalOperator } = regexResult;
                const { fieldName, aggregationOperator } = regexResult;
                const fieldType = refNode.primitiveFields.find((name) => name.fieldName === fieldName)?.typeMeta.name;

                let operation;
                if (fieldType === "String" && aggregationOperator) {
                    operation = createBaseOperation({
                        operator: logicalOperator || "EQ",
                        property: getAggregateOperation(Cypher.size(target.property(fieldName)), aggregationOperator),
                        param: paramName,
                    });
                } else if (aggregationOperator) {
                    operation = createBaseOperation({
                        operator: logicalOperator || "EQ",
                        property: getAggregateOperation(target.property(fieldName), aggregationOperator),
                        param: paramName,
                    });
                } else {
                    const innerVar = new Cypher.Variable();
                    const innerOperation = createBaseOperation({
                        operator: logicalOperator || "EQ",
                        property: innerVar,
                        param: paramName,
                    });

                    const collectedProperty =
                        fieldType === "String" && logicalOperator !== "EQUAL"
                            ? Cypher.collect(Cypher.size(target.property(fieldName)))
                            : Cypher.collect(target.property(fieldName));
                    operation = Cypher.any(innerVar, collectedProperty, innerOperation);
                }
                const operationVar = new Cypher.Variable();
                return {
                    returnVariables: [[operation, operationVar]],
                    predicates: [Cypher.eq(operationVar, new Cypher.Param(true))],
                };
            }
        })
        .reduce(aggregateWhereReducer, {
            returnVariables: [],
            predicates: [],
        });
}

function getAggregateOperation(
    property: Cypher.PropertyRef | Cypher.Function,
    aggregationOperator: string
): Cypher.Function {
    switch (aggregationOperator) {
        case "AVERAGE":
            return Cypher.avg(property);
        case "MIN":
        case "SHORTEST":
            return Cypher.min(property);
        case "MAX":
        case "LONGEST":
            return Cypher.max(property);
        case "SUM":
            return Cypher.sum(property);
        default:
            throw new Error(`Invalid operator ${aggregationOperator}`);
    }
}

// TODO: remove everything below once apoc.runFirstColumn removed from aggregate filters

function createOperator(input: string): Operator {
    let operator: Operator = "=";

    switch (input) {
        case "LT":
            operator = "<";
            break;
        case "LTE":
            operator = "<=";
            break;
        case "GT":
            operator = ">";
            break;
        case "GTE":
            operator = ">=";
            break;
        default:
            operator = "=";
            break;
    }

    return operator;
}

function aggregate({
    inputValue,
    nodeOrRelationship,
    chainStr,
    variable,
}: {
    inputValue: any;
    nodeOrRelationship: GraphElement;
    chainStr: string;
    variable: string;
}): { aggregations: string[]; params: any; withStrs: string[] } {
    const aggregations: string[] = [];
    let withStrs: string[] = [];
    let params = {};

    Object.entries(inputValue).forEach(([key, value]) => {
        if (logicalOperators.includes(key)) {
            const innerClauses: string[] = [];

            (value as any[]).forEach((v: any, i) => {
                const recurse = aggregate({
                    chainStr: `${chainStr}_${key}_${i}`,
                    inputValue: v,
                    nodeOrRelationship,
                    variable,
                });

                if (recurse.aggregations.length) {
                    innerClauses.push(recurse.aggregations.join(" AND "));
                    params = { ...params, ...recurse.params };
                }

                if (recurse.withStrs.length) {
                    withStrs = [...withStrs, ...recurse.withStrs];
                }
            });

            if (innerClauses.length) {
                aggregations.push(`(${innerClauses.join(` ${key} `)})`);
            }

            return;
        }

        const field = [...nodeOrRelationship.primitiveFields, ...nodeOrRelationship.temporalFields].find((f) =>
            comparisonOperators.some(
                (op) =>
                    key.split(`_${op}`)[0] === f.fieldName ||
                    key.split(`_AVERAGE_${op}`)[0] === f.fieldName ||
                    aggregationOperators.some((x) => key.split(`_${x}_${op}`)[0] === f.fieldName)
            )
        ) as BaseField;

        const dbPropertyName = field.dbPropertyName || field.fieldName;

        if (!field) {
            return;
        }

        const [, operatorString] = key.split(`${field.fieldName}_`);
        const paramName = `${chainStr}_${key}`;
        params[paramName] = value;

        if (comparisonOperators.some((fO) => operatorString.split(`AVERAGE_`)[1] === fO)) {
            const [, averageOperatorString] = operatorString.split("AVERAGE_");
            const averageOperator = createOperator(averageOperatorString);

            if (field.typeMeta.name === "String") {
                const hoistedVariable = `${paramName}_SIZE`;

                withStrs.push(`size(${variable}.${dbPropertyName}) AS ${hoistedVariable}`);

                aggregations.push(`avg(${hoistedVariable}) ${averageOperator} toFloat($${paramName})`);

                return;
            }

            aggregations.push(`avg(${variable}.${dbPropertyName}) ${averageOperator} $${paramName}`);

            return;
        }

        if (comparisonOperators.some((fO) => operatorString.split(`SUM_`)[1] === fO)) {
            const [, opStr] = operatorString.split("SUM_");
            const operator = createOperator(opStr);

            aggregations.push(`sum(${variable}.${dbPropertyName}) ${operator} toFloat($${paramName})`);

            return;
        }

        if (aggregationOperators.some((fO) => comparisonOperators.includes(operatorString.split(`${fO}_`)[1]))) {
            if (field.typeMeta.name === "String") {
                const hoistedVariable = `${paramName}_SIZE`;
                const isShortest = operatorString.startsWith("SHORTEST_");
                const [, stringOperator] = operatorString.split(`${isShortest ? `SHORTEST` : "LONGEST"}_`);

                withStrs.push(`size(${variable}.${dbPropertyName}) AS ${hoistedVariable}`);

                aggregations.push(
                    `${isShortest ? `min` : "max"}(${hoistedVariable}) ${createOperator(stringOperator)} $${paramName}`
                );

                return;
            }

            const isMin = operatorString.startsWith("MIN_");
            const [, opString] = operatorString.split(`${isMin ? `MIN` : "MAX"}_`);

            aggregations.push(
                ` ${isMin ? `min` : "max"}(${variable}.${dbPropertyName}) ${createOperator(opString)} $${paramName}`
            );

            return;
        }

        const operator = createOperator(operatorString);

        if (field.typeMeta.name === "String") {
            if (operator !== "=") {
                aggregations.push(`size(${variable}.${dbPropertyName}) ${operator} $${paramName}`);

                return;
            }
        }

        // Default
        aggregations.push(`${variable}.${dbPropertyName} ${operator} $${paramName}`);
    });

    return {
        aggregations,
        params,
        withStrs,
    };
}

function createPredicate({
    node,
    aggregation,
    context,
    chainStr,
    field,
    nodeVariable,
    edgeVariable,
    relationship,
}: {
    aggregation: any;
    node: Node;
    context: Context;
    chainStr: string;
    field: RelationField;
    nodeVariable: string;
    edgeVariable: string;
    relationship: Relationship;
}): { aggregations: string[]; params: any; withStrs: string[] } {
    const aggregations: string[] = [];
    let withStrs: string[] = [];
    let params = {};

    Object.entries(aggregation).forEach(([key, value]) => {
        if (logicalOperators.includes(key)) {
            const innerClauses: string[] = [];

            (value as any[]).forEach((v: any, i) => {
                const recurse = createPredicate({
                    node,
                    chainStr: `${chainStr}_${key}_${i}`,
                    context,
                    field,
                    aggregation: v,
                    nodeVariable,
                    edgeVariable,
                    relationship,
                });

                if (recurse.aggregations.length) {
                    innerClauses.push(recurse.aggregations.join(" AND "));
                    params = { ...params, ...recurse.params };
                }

                if (recurse.withStrs.length) {
                    withStrs = [...withStrs, ...recurse.withStrs];
                }
            });

            if (innerClauses.length) {
                aggregations.push(`(${innerClauses.join(` ${key} `)})`);
            }

            return;
        }

        countOperators.forEach((countType) => {
            if (key === countType) {
                const paramName = `${chainStr}_${key}`;
                params[paramName] = value;
                const operator = createOperator(countType.split("_")[1]);
                aggregations.push(`count(${nodeVariable}) ${operator} $${paramName}`);
            }
        });

        entities.forEach((nOrE) => {
            if (key !== nOrE) {
                return;
            }

            const agg = aggregate({
                chainStr: `${chainStr}_${key}`,
                inputValue: value,
                nodeOrRelationship: nOrE === "node" ? node : relationship,
                variable: nOrE === "node" ? nodeVariable : edgeVariable,
            });

            if (agg.aggregations.length) {
                aggregations.push(agg.aggregations.join(" AND "));
                params = { ...params, ...agg.params };
            }

            if (agg.withStrs.length) {
                withStrs = [...withStrs, ...agg.withStrs];
            }
        });
    });

    return {
        aggregations,
        params,
        withStrs,
    };
}

function createAggregateWhereAndParams({
    node,
    field,
    varName,
    chainStr,
    context,
    aggregation,
    relationship,
}: {
    node: Node;
    field: RelationField;
    varName: string;
    chainStr: string;
    context: Context;
    aggregation: any;
    relationship: Relationship;
}): [string, any] {
    const cyphers: string[] = [];
    const inStr = field.direction === "IN" ? "<-" : "-";
    const outStr = field.direction === "OUT" ? "->" : "-";
    const nodeVariable = `${chainStr}_node`;
    const edgeVariable = `${chainStr}_edge`;
    const relTypeStr = `[${edgeVariable}:${field.type}]`;
    const labels = node.getLabelString(context);
    const matchStr = `MATCH (${varName})${inStr}${relTypeStr}${outStr}(${nodeVariable}${labels})`;

    cyphers.push(`apoc.cypher.runFirstColumnSingle(" ${matchStr}`);

    const { aggregations, params, withStrs } = createPredicate({
        aggregation,
        chainStr,
        context,
        field,
        node,
        nodeVariable,
        edgeVariable,
        relationship,
    });

    if (withStrs.length) {
        const uniqueWithList = [nodeVariable, edgeVariable, ...new Set(withStrs)];
        cyphers.push(`WITH ${uniqueWithList.join(", ")}`);
    }

    if (aggregations.length) {
        cyphers.push(`RETURN ${aggregations.join(" AND ")}`);
    }

    const apocParams = Object.keys(params).length
        ? `, ${Object.keys(params)
              .map((x) => `${x}: $${x}`)
              .join(", ")}`
        : "";

    cyphers.push(`", { ${varName}: ${varName}${apocParams} })`);

    return [cyphers.join("\n"), params];
}

export default createAggregateWhereAndParams;
