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

import type { IResolvers } from "@graphql-tools/utils";
import {
    DefinitionNode,
    DirectiveNode,
    DocumentNode,
    FieldDefinitionNode,
    GraphQLEnumType,
    GraphQLInputObjectType,
    GraphQLInt,
    GraphQLInterfaceType,
    GraphQLList,
    GraphQLObjectType,
    GraphQLScalarType,
    InterfaceTypeDefinitionNode,
    NameNode,
    ObjectTypeDefinitionNode,
    SchemaExtensionNode,
} from "graphql";
import { GraphQLID, GraphQLNonNull, Kind, parse, print } from "graphql";
import type {
    InputTypeComposer,
    InputTypeComposerFieldConfigMapDefinition,
    InterfaceTypeComposer,
    ObjectTypeComposer,
    ObjectTypeComposerFieldConfigMap,
    ObjectTypeComposerFieldConfigMapDefinition,
    UnionTypeComposer,
} from "graphql-compose";
import { SchemaComposer } from "graphql-compose";
import pluralize from "pluralize";
import { AggregationTypesMapper } from "./aggregations/aggregation-types-mapper";
import { augmentFulltextSchema2 } from "./augment/fulltext";
import { cypherResolver2 } from "./resolvers/field/cypher";
import { numericalResolver } from "./resolvers/field/numerical";
import { createResolver2 } from "./resolvers/mutation/create";
import { deleteResolver2 } from "./resolvers/mutation/delete";
import { updateResolver2 } from "./resolvers/mutation/update";
import { aggregateResolver2 } from "./resolvers/query/aggregate";
import { findResolver2 } from "./resolvers/query/read";
import { rootConnectionResolver2 } from "./resolvers/query/root-connection";
// import * as constants from "../constants";
import type { Node } from "../classes";
import type Relationship from "../classes/Relationship";
import * as Scalars from "../graphql/scalars";
import { isRootType } from "../utils/is-root-type";
import { ensureNonEmptyInput } from "./ensure-non-empty-input";
import getCustomResolvers from "./get-custom-resolvers";
import type { DefinitionNodes } from "./get-definition-nodes";
import { getDefinitionNodes } from "./get-definition-nodes";
import type { ObjectFields } from "./get-obj-field-meta";
import getObjFieldMeta from "./get-obj-field-meta";
import {
    getWhereFieldsForAttributes,
    getWhereFieldsFromConcreteEntity,
    getWhereFieldsFromRelationshipProperties,
} from "./get-where-fields";
import {
    attributeAdapterToComposeFields,
    concreteEntityToCreateInputFields,
    concreteEntityToUpdateInputFields,
    graphqlDirectivesToCompose,
    relationshipAdapterToComposeFields,
    withArrayOperators,
    withMathOperators,
} from "./to-compose";

// GraphQL type imports
import type { Subgraph } from "../classes/Subgraph";
import {
    DEPRECATED,
    FIELD_DIRECTIVES,
    INTERFACE_DIRECTIVES,
    OBJECT_DIRECTIVES,
    PROPAGATED_DIRECTIVES,
} from "../constants";
import { SortDirection } from "../graphql/enums/SortDirection";
import { CartesianPointDistance } from "../graphql/input-objects/CartesianPointDistance";
import { CartesianPointInput } from "../graphql/input-objects/CartesianPointInput";
import { FloatWhere } from "../graphql/input-objects/FloatWhere";
import { PointDistance } from "../graphql/input-objects/PointDistance";
import { PointInput } from "../graphql/input-objects/PointInput";
import { QueryOptions } from "../graphql/input-objects/QueryOptions";
import { CartesianPoint } from "../graphql/objects/CartesianPoint";
import { CreateInfo } from "../graphql/objects/CreateInfo";
import { DeleteInfo } from "../graphql/objects/DeleteInfo";
import { PageInfo } from "../graphql/objects/PageInfo";
import { Point } from "../graphql/objects/Point";
import { UpdateInfo } from "../graphql/objects/UpdateInfo";
import type { Neo4jGraphQLSchemaModel } from "../schema-model/Neo4jGraphQLSchemaModel";
import type { Operation } from "../schema-model/Operation";
import { OperationAdapter } from "../schema-model/OperationAdapter";
import { ConcreteEntity } from "../schema-model/entity/ConcreteEntity";
import { InterfaceEntity } from "../schema-model/entity/InterfaceEntity";
import { UnionEntity } from "../schema-model/entity/UnionEntity";
import { ConcreteEntityAdapter } from "../schema-model/entity/model-adapters/ConcreteEntityAdapter";
import { InterfaceEntityAdapter } from "../schema-model/entity/model-adapters/InterfaceEntityAdapter";
import { UnionEntityAdapter } from "../schema-model/entity/model-adapters/UnionEntityAdapter";
import { RelationshipAdapter } from "../schema-model/relationship/model-adapters/RelationshipAdapter";
import type { CypherField, Neo4jFeaturesSettings } from "../types";
import { isInArray } from "../utils/is-in-array";
import { addArrayMethodsToITC2 } from "./array-methods";
import { createConnectionFields2 } from "./create-connection-fields";
import { addGlobalNodeFields } from "./create-global-nodes";
import { createRelationshipFieldsFromConcreteEntityAdapter } from "./create-relationship-fields/create-relationship-fields";
import getNodes from "./get-nodes";
import { getResolveAndSubscriptionMethods } from "./get-resolve-and-subscription-methods";
import { filterInterfaceTypes } from "./make-augmented-schema/filter-interface-types";
import { addMathOperatorsToITC } from "./math";
import { generateSubscriptionTypes, generateSubscriptionTypes2 } from "./subscriptions/generate-subscription-types";
import { AttributeAdapter } from "../schema-model/attribute/model-adapters/AttributeAdapter";

function definitionNodeHasName(x: DefinitionNode): x is DefinitionNode & { name: NameNode } {
    return "name" in x;
}

class SchemaGeneratorModel {
    // contains type names for now
    static createInfoTypeName: string;
    static updateInfoTypeName: string;
    static deleteInfoTypeName: string;
    static pageInfoTypeName: string;
    static {
        this.createInfoTypeName = "CreateInfo";
        this.updateInfoTypeName = "UpdateInfo";
        this.deleteInfoTypeName = "DeleteInfo";
        this.pageInfoTypeName = "PageInfo";
    }
}

class AugmentedSchemaGenerator {
    private composer: SchemaComposer;

    constructor(
        private schemaModel: Neo4jGraphQLSchemaModel,
        private definitionNodes: DefinitionNodes,
        private rootTypesCustomResolvers: ObjectTypeDefinitionNode[]
    ) {
        this.composer = new SchemaComposer();
    }

    generate() {
        let pointInTypeDefs = false;
        let cartesianPointInTypeDefs = false;
        let floatWhereInTypeDefs = false;

        for (const entity of this.schemaModel.entities.values()) {
            const model =
                entity instanceof ConcreteEntity
                    ? new ConcreteEntityAdapter(entity)
                    : entity instanceof InterfaceEntity
                    ? new InterfaceEntityAdapter(entity)
                    : new UnionEntityAdapter(entity as UnionEntity); // fixme

            // TODO: check if these can be created ad-hoc
            if (model instanceof ConcreteEntityAdapter || model instanceof InterfaceEntityAdapter) {
                for (const attribute of model.attributes.values()) {
                    if (attribute.isPoint()) {
                        pointInTypeDefs = true;
                    }
                    if (attribute.isCartesianPoint()) {
                        cartesianPointInTypeDefs = true;
                    }
                }
                if ("annotations" in model && model.annotations.fulltext) {
                    floatWhereInTypeDefs = true;
                }
                if (model instanceof ConcreteEntityAdapter) {
                    for (const relationship of model.relationships.values()) {
                        for (const attribute of relationship.attributes.values()) {
                            if (attribute.isPoint()) {
                                pointInTypeDefs = true;
                            }
                            if (attribute.isCartesianPoint()) {
                                cartesianPointInTypeDefs = true;
                            }
                        }
                    }
                }
            }
        }

        // this.pipeDefs();
        this.addToComposer(this.getStaticTypes());
        this.addToComposer(this.getSpatialTypes(pointInTypeDefs, cartesianPointInTypeDefs));
        this.addToComposer(this.getTemporalTypes(floatWhereInTypeDefs));

        // this.add(this.getEntityTypes());
        // const relationshipPropertiesTypes = this.getRelationshipProperties(
        //     this._definitionCollection.relationshipProperties
        // );
        // this.add(relationshipPropertiesTypes);

        return this.composer;
    }

    private pipeDefs() {
        const pipedDefs = [
            ...this.definitionNodes.enumTypes,
            ...this.definitionNodes.scalarTypes,
            ...this.definitionNodes.inputObjectTypes,
            ...this.definitionNodes.unionTypes,
            ...this.definitionNodes.directives,
            ...this.rootTypesCustomResolvers,
        ].filter(Boolean);
        if (pipedDefs.length) {
            this.composer.addTypeDefs(print({ kind: Kind.DOCUMENT, definitions: pipedDefs }));
        }
    }

    private getStaticTypes() {
        return {
            objects: [CreateInfo, DeleteInfo, UpdateInfo, PageInfo],
            inputs: [QueryOptions],
            enums: [SortDirection],
            scalars: Object.values(Scalars),
        };
    }

    private getSpatialTypes(
        pointInTypeDefs: boolean,
        cartesianPointInTypeDefs: boolean
    ): {
        objects: GraphQLObjectType[];
        inputs: GraphQLInputObjectType[];
    } {
        const objects: GraphQLObjectType[] = [];
        const inputs: GraphQLInputObjectType[] = [];
        if (pointInTypeDefs) {
            objects.push(Point);
            inputs.push(PointInput, PointDistance);
        }
        if (cartesianPointInTypeDefs) {
            objects.push(CartesianPoint);
            inputs.push(CartesianPointInput, CartesianPointDistance);
        }
        return {
            objects,
            inputs,
        };
    }

    private getTemporalTypes(floatWhereInTypeDefs: boolean): {
        inputs: GraphQLInputObjectType[];
    } {
        const inputs: GraphQLInputObjectType[] = [];
        if (floatWhereInTypeDefs) {
            inputs.push(FloatWhere);
        }
        return {
            inputs,
        };
    }

    /*
    private addGlobalNodeFields(concreteEntities: ConcreteEntity[], nodes: Node[]) {
        const globalEntities = concreteEntities.filter((entity) => {
            const model = new ConcreteEntityAdapter(entity);
            return model.isGlobalNode();
        });
        const globalNodes = nodes.filter((n) => globalEntities.find((e) => e.name === n.name));

        const fetchById = (id: string, context: Context, info: GraphQLResolveInfo) => {
            const resolver = globalNodeResolver({ nodes: globalNodes });
            return resolver.resolve(null, { id }, context, info);
        };

        const resolveType = (obj: { [key: string]: unknown; __resolveType: string }) => obj.__resolveType;

        const { nodeInterface, nodeField } = nodeDefinitions(fetchById, resolveType);

        this._composer.createInterfaceTC(nodeInterface);
        this._composer.Query.addFields({
            node: nodeField as ObjectTypeComposerFieldConfigAsObjectDefinition<null, Context, { id: string }>,
        });
    }

    // TODO: alternatively, get these from Entity.Relationship
    private getRelationshipProperties(relationshipPropertiesInterface: CompositeEntity) {
        new ToComposer(relationshipPropertiesInterface)
            .withInterfaceType()
            .withSortInputType()
            .withWhereInputType({ enabledFeatures })
            .withUpdateInputType({ addMathOperators: true, addArrayMethods: true })
            .withCreateInputType()
            .build(this._composer);
    }

        private getEntityTypes() {
        // TODO: consider Factory
        this.schemaModel.concreteEntities.forEach((concreteEntity) => {
            new ToComposer(concreteEntity)
                .withObjectType()
                .withSortInputType()
                .withWhereInputType({ enabledFeatures })
                .withUpdateInputType({ addMathOperators: true, addArrayMethods: true })
                .withCreateInputType()
                .build(this._composer);
        });
    }

*/
    private addToComposer({
        objects = [],
        inputs = [],
        enums = [],
        scalars = [],
        interfaces = [],
    }: {
        objects?: GraphQLObjectType[];
        inputs?: GraphQLInputObjectType[];
        enums?: GraphQLEnumType[];
        scalars?: GraphQLScalarType[];
        interfaces?: GraphQLInterfaceType[];
    }) {
        objects.forEach((x) => this.composer.createObjectTC(x));
        inputs.forEach((x) => this.composer.createInputTC(x));
        enums.forEach((x) => this.composer.createEnumTC(x));
        interfaces.forEach((x) => this.composer.createInterfaceTC(x));
        scalars.forEach((scalar) => this.composer.addTypeDefs(`scalar ${scalar.name}`));
    }
}

// abstract ComposerBuilder
// ConcreteEntityBuilder extends ComposerBuilder
// CompositeEntityBuilder extends ComposerBuilder

/*
class ToComposer {
    _entity: ConcreteEntity | CompositeEntity;
    _entityModel: ConcreteEntityAdapter | CompositeEntityAdapter;
    _ts: TypeStorage;

    constructor(fromEntity: ConcreteEntity | CompositeEntity) {
        this._entity = fromEntity;
        this._entityModel =
            this._entity instanceof ConcreteEntity
                ? new ConcreteEntityAdapter(this._entity)
                : new CompositeEntityAdapter(this._entity);
        this._ts = new TypeStorage();
    }

    public withInterfaceType() {
        // this._tempComposer.add(InterfaceTypeComposer.createTemp(this._currentType));
        this._ts.set(
            this._entity.name,
            InterfaceTypeComposer.createTemp({
                name: this._entity.name,
                fields: ToComposer._attributesToComposeFields(Array.from(this._entityModel.attributes.values())),
            })
        );
        return this;
    }

    public withObjectType() {
        this._ts.set(
            this._entity.name,
            ObjectTypeComposer.createTemp({
                name: this._entity.name,
                fields: ToComposer._attributesToComposeFields(Array.from(this._entityModel.attributes.values())),
                // TODO: add description field
                // description: this._entity.description,
                // TODO: discuss with Simone - create an AnnotationAdapter or logic straight in AttributeAdapter
                // directives: graphqlDirectivesToCompose([...node.otherDirectives, ...node.propagatedDirectives]),
                // TODO: discuss with Simone - add interfaces to ConcreteEntity
                // interfaces: this._entity.interfaces.map((x) => x.name.value)
            })
        );
        return this;
    }

    public withSortInputType() {
        const sortTypeName = `${this._entity.name}Sort`;
        const currentType = this._ts.get(this._entity.name);
        this._ts.set(
            sortTypeName,
            InputTypeComposer.createTemp({
                name: sortTypeName,
                fields: currentType.getFieldNames().reduce((res, f) => {
                    return { ...res, [f]: "SortDirection" };
                }, {}),
            })
        );
        return this;
    }

    public withWhereInputType({ enabledFeatures }) {
        const whereTypeName = `${this._entity.name}Where`;
        this._ts.set(
            whereTypeName,
            InputTypeComposer.createTemp({
                name: whereTypeName,
                fields: ToComposer._attributesToComposeFields(this._entityModel.getCreateInputTypeFields()),
                // TODO: refactor getWhereFields
                // getWhereFields({ typeName: relationship.name.value, fields: adapter.getWhereInputTypeFields(), enabledFeatures: features.filters })
            })
        );
        return this;
    }

    public withUpdateInputType({ addMathOperators = true, addArrayMethods = true }) {
        const updateTypeName = `${this._entity.name}UpdateInput`;
        const updateInput = InputTypeComposer.createTemp({
            name: updateTypeName,
            fields: ToComposer._attributesToComposeFields(this._entityModel.getUpdateInputTypeFields()),
        });
        addMathOperators && addMathOperatorsToITC(updateInput);
        addArrayMethods && addArrayMethodsToITC(updateInput, relFields.primitiveFields);
        addArrayMethods && addArrayMethodsToITC(updateInput, relFields.pointFields);
        this._ts.set(updateTypeName, updateInput);

        return this;

        // TODO: add these
        // addMathOperatorsToITC(relationshipUpdateITC);
        // addArrayMethodsToITC(relationshipUpdateITC, relFields.primitiveFields);
        // addArrayMethodsToITC(relationshipUpdateITC, relFields.pointFields);
    }

    public withCreateInputType() {
        const createTypeName = `${this._entity.name}CreateInput`;
        this._ts.set(
            createTypeName,
            InputTypeComposer.createTemp({
                name: createTypeName,
                fields: ToComposer._attributesToComposeFields(this._entityModel.getCreateInputTypeFields()),
            })
        );

        return this;
    }

    public build(_composer: SchemaComposer) {
        // _composer.createInterfaceTC(x);

        this._ts.forEach((v) => {
            _composer.add(v);
        });

        // _composer.merge(t);
    }
}
*/

function getUserDefinedFieldDirectivesForDefinition(
    definitionNode: ObjectTypeDefinitionNode | InterfaceTypeDefinitionNode,
    definitionNodes: DefinitionNodes
): Map<string, DirectiveNode[]> {
    const userDefinedFieldDirectives = new Map<string, DirectiveNode[]>();

    const allFields: Array<FieldDefinitionNode> = [...(definitionNode.fields || [])];
    // TODO: is it a good idea to inherit the field directives from implemented interfaces?
    // makes sense for deprecated but for other user-defined directives??
    if (definitionNode.interfaces) {
        for (const inheritsFrom of definitionNode.interfaces) {
            const interfaceDefinition = definitionNodes.interfaceTypes.find(
                (type) => type.name.value === inheritsFrom.name.value
            );
            const inheritedFields = interfaceDefinition?.fields;
            if (inheritedFields) {
                allFields.push(...inheritedFields);
            }
        }
    }
    for (const field of allFields) {
        if (!field.directives) {
            return userDefinedFieldDirectives;
        }

        const matched = field.directives.filter((directive) => !isInArray(FIELD_DIRECTIVES, directive.name.value));
        if (matched.length) {
            userDefinedFieldDirectives.set(field.name.value, matched);
        }
    }

    return userDefinedFieldDirectives;
}

// make types
function withObjectType(
    concreteEntity: ConcreteEntityAdapter, // required
    userDefinedFieldDirectives: Map<string, DirectiveNode[]>,
    directives: DirectiveNode[],
    composer: SchemaComposer
): ObjectTypeComposer {
    const nodeFields = attributeAdapterToComposeFields(concreteEntity.objectFields, userDefinedFieldDirectives);
    const composeNode = composer.createObjectTC({
        name: concreteEntity.name,
        fields: nodeFields,
        description: concreteEntity.description,
        directives: graphqlDirectivesToCompose(directives),
        interfaces: concreteEntity.compositeEntities.filter((e) => e instanceof InterfaceEntity).map((e) => e.name),
    });
    // TODO: maybe split this global node logic?
    if (concreteEntity.isGlobalNode()) {
        composeNode.setField("id", {
            type: new GraphQLNonNull(GraphQLID),
            resolve: (src) => {
                const field = concreteEntity.globalIdField.name;
                const value = src[field] as string | number;
                return concreteEntity.toGlobalId(value.toString());
            },
        });
        composeNode.addInterface("Node");
    }
    return composeNode;
}

function withInterfaceType(
    entityAdapter: InterfaceEntityAdapter | RelationshipAdapter, // required
    userDefinedFieldDirectives: Map<string, DirectiveNode[]>,
    directives: DirectiveNode[],
    composer: SchemaComposer,
    config = {
        includeRelationships: false,
    }
): InterfaceTypeComposer {
    // TODO: maybe create interfaceEntity.interfaceFields() method abstraction even if it retrieves all attributes?
    // can also take includeRelationships as argument
    const objectComposeFields = attributeAdapterToComposeFields(
        Array.from(entityAdapter.attributes.values()),
        userDefinedFieldDirectives
    );
    let fields = objectComposeFields;
    if (config.includeRelationships && entityAdapter instanceof InterfaceEntityAdapter) {
        fields = {
            ...fields,
            ...relationshipAdapterToComposeFields(
                Array.from(entityAdapter.relationships.values()),
                userDefinedFieldDirectives
            ),
        };
    }
    const interfaceTypeName =
        entityAdapter instanceof InterfaceEntityAdapter
            ? entityAdapter.name
            : (entityAdapter.propertiesTypeName as string); // this is checked one layer above in execution
    const composeInterface = composer.createInterfaceTC({
        name: interfaceTypeName,
        fields: fields,
        directives: graphqlDirectivesToCompose(directives),
    });
    return composeInterface;
}

function withOptionsInputType(
    entityAdapter: ConcreteEntityAdapter | InterfaceEntityAdapter, // required
    userDefinedFieldDirectives: Map<string, DirectiveNode[]>,
    composer: SchemaComposer
): InputTypeComposer {
    const optionsInputType = makeOptionsInput(entityAdapter, composer);
    if (!entityAdapter.sortableFields.length) {
        return optionsInputType;
    }
    const sortInput = makeSortInput(entityAdapter, userDefinedFieldDirectives, composer);
    // TODO: Concrete vs Abstract discrepency
    // is this intended? For ConcreteEntity is NonNull, for InterfaceEntity is nullable
    const sortFieldType = entityAdapter instanceof ConcreteEntityAdapter ? sortInput.NonNull.List : sortInput.List;
    optionsInputType.addFields({
        sort: {
            description: `Specify one or more ${entityAdapter.operations.sortInputTypeName} objects to sort ${entityAdapter.upperFirstPlural} by. The sorts will be applied in the order in which they are arranged in the array.`,
            type: sortFieldType,
        },
    });
    return optionsInputType;
}

function withSortInputType(
    relationshipAdapter: RelationshipAdapter, // required
    userDefinedFieldDirectives: Map<string, DirectiveNode[]>,
    composer: SchemaComposer
): InputTypeComposer | undefined {
    // TODO: for relationships we used to get all attributes, not just sortableFields
    // Clarify if this is intended?
    if (!relationshipAdapter.sortableFields.length) {
        return;
    }
    return makeSortInput(relationshipAdapter, userDefinedFieldDirectives, composer);
}

function withWhereInputType(
    entityAdapter: ConcreteEntityAdapter | InterfaceEntityAdapter | UnionEntityAdapter | RelationshipAdapter, // required
    userDefinedFieldDirectives: Map<string, DirectiveNode[]>,
    features: Neo4jFeaturesSettings | undefined,
    composer: SchemaComposer
): InputTypeComposer {
    const whereInputType = makeWhereInput(entityAdapter, userDefinedFieldDirectives, features, composer);

    if (entityAdapter instanceof ConcreteEntityAdapter) {
        whereInputType.addFields({
            OR: `[${entityAdapter.operations.whereInputTypeName}!]`,
            AND: `[${entityAdapter.operations.whereInputTypeName}!]`,
            NOT: entityAdapter.operations.whereInputTypeName,
        });
        if (entityAdapter.isGlobalNode()) {
            whereInputType.addFields({ id: GraphQLID });
        }
    } else if (entityAdapter instanceof RelationshipAdapter) {
        whereInputType.addFields({
            OR: `[${entityAdapter.operations.whereInputTypeName}!]`,
            AND: `[${entityAdapter.operations.whereInputTypeName}!]`,
            NOT: entityAdapter.operations.whereInputTypeName,
        });
    } else if (entityAdapter instanceof InterfaceEntityAdapter) {
        const implementationsWhereInputType = makeImplementationsWhereInput(entityAdapter, composer);
        whereInputType.addFields({ _on: implementationsWhereInputType });
    }
    return whereInputType;
}

function withUniqueWhereInputType(
    entityAdapter: ConcreteEntityAdapter, // required
    composer: SchemaComposer
): InputTypeComposer {
    const uniqueWhereFields: InputTypeComposerFieldConfigMapDefinition = {};
    for (const attribute of entityAdapter.uniqueFields) {
        uniqueWhereFields[attribute.name] = attribute.getFieldTypeName();
    }
    const uniqueWhereInputType = composer.createInputTC({
        name: entityAdapter.operations.uniqueWhereInputTypeName,
        fields: uniqueWhereFields,
    });
    return uniqueWhereInputType;
}

function withAggregateSelectionType(
    concreteEntity: ConcreteEntityAdapter, // required
    aggregationTypesMapper: AggregationTypesMapper,
    propagatedDirectives: DirectiveNode[],
    composer: SchemaComposer
): ObjectTypeComposer {
    const aggregateSelection = composer.createObjectTC({
        name: concreteEntity.operations.aggregateTypeNames.selection,
        fields: {
            count: {
                type: new GraphQLNonNull(GraphQLInt),
                resolve: numericalResolver,
                args: {},
            },
        },
        directives: graphqlDirectivesToCompose(propagatedDirectives),
    });
    aggregateSelection.addFields(makeAggregableFields(concreteEntity, aggregationTypesMapper));
    return aggregateSelection;
}

function withCreateInputType(
    entityAdapter: ConcreteEntityAdapter | InterfaceEntityAdapter | RelationshipAdapter, // required
    userDefinedFieldDirectives: Map<string, DirectiveNode[]>,
    composer: SchemaComposer
): InputTypeComposer {
    const createInputType = composer.createInputTC({
        name: entityAdapter.operations.createInputTypeName,
        fields: {},
    });

    if (entityAdapter instanceof ConcreteEntityAdapter || entityAdapter instanceof RelationshipAdapter) {
        createInputType.addFields(
            concreteEntityToCreateInputFields(entityAdapter.createInputFields, userDefinedFieldDirectives)
        );
    } else {
        createInputType.addFields(makeCreateInputFields(entityAdapter));
    }

    // ensureNonEmptyInput(composer, createInputType); - not for relationshipAdapter
    return createInputType;
}

function withUpdateInputType(
    entityAdapter: ConcreteEntityAdapter | InterfaceEntityAdapter | RelationshipAdapter, // required
    userDefinedFieldDirectives: Map<string, DirectiveNode[]>,
    composer: SchemaComposer
): InputTypeComposer {
    const inputTypeName =
        entityAdapter instanceof RelationshipAdapter
            ? entityAdapter.operations.edgeUpdateInputTypeName
            : entityAdapter.operations.updateMutationArgumentNames.update;
    const updateInputType = composer.createInputTC({
        name: inputTypeName,
        fields: {},
    });

    if (entityAdapter instanceof ConcreteEntityAdapter || entityAdapter instanceof RelationshipAdapter) {
        updateInputType.addFields(
            concreteEntityToUpdateInputFields(entityAdapter.updateInputFields, userDefinedFieldDirectives, [
                withMathOperators(),
                withArrayOperators(),
            ])
        );
    } else {
        updateInputType.addFields(
            concreteEntityToUpdateInputFields(entityAdapter.updateInputFields, userDefinedFieldDirectives, [
                withMathOperators(),
            ])
        );
        const implementationsUpdateInputType = makeImplementationsUpdateInput(entityAdapter, composer);
        updateInputType.addFields({ _on: implementationsUpdateInputType });
    }

    // ensureNonEmptyInput(composer, updateInputType); - not for relationshipAdapter
    return updateInputType;
}

function withDeleteInputType(
    entityAdapter: InterfaceEntityAdapter, // required
    composer: SchemaComposer
): InputTypeComposer | undefined {
    const implementationsUpdateInputType = makeImplementationsDeleteInput(entityAdapter, composer);
    if (implementationsUpdateInputType) {
        const deleteInputType = composer.getOrCreateITC(entityAdapter.operations.updateMutationArgumentNames.delete);
        deleteInputType.setField("_on", implementationsUpdateInputType);
        return deleteInputType;
    }
    return undefined;
}
function withConnectInputType(
    entityAdapter: InterfaceEntityAdapter, // required
    composer: SchemaComposer
): InputTypeComposer | undefined {
    const implementationsConnectInputType = makeImplementationsConnectInput(entityAdapter, composer);
    if (implementationsConnectInputType) {
        const connectInputType = composer.getOrCreateITC(entityAdapter.operations.updateMutationArgumentNames.connect);
        connectInputType.setField("_on", implementationsConnectInputType);
        return connectInputType;
    }
    return undefined;
}
function withDisconnectInputType(
    entityAdapter: InterfaceEntityAdapter, // required
    composer: SchemaComposer
): InputTypeComposer | undefined {
    const implementationsDisconnectInputType = makeImplementationsDisconnectInput(entityAdapter, composer);
    if (implementationsDisconnectInputType) {
        const disconnectInputType = composer.getOrCreateITC(
            entityAdapter.operations.updateMutationArgumentNames.disconnect
        );
        disconnectInputType.setField("_on", implementationsDisconnectInputType);
        return disconnectInputType;
    }
    return undefined;
}

function withMutationResponseTypes(
    concreteEntityAdapter: ConcreteEntityAdapter, // required
    propagatedDirectives: DirectiveNode[],
    composer: SchemaComposer
): void {
    composer.createObjectTC({
        name: concreteEntityAdapter.operations.mutationResponseTypeNames.create,
        fields: {
            info: new GraphQLNonNull(CreateInfo),
            [concreteEntityAdapter.plural]: `[${concreteEntityAdapter.name}!]!`,
        },
        directives: graphqlDirectivesToCompose(propagatedDirectives),
    });

    composer.createObjectTC({
        name: concreteEntityAdapter.operations.mutationResponseTypeNames.update,
        fields: {
            info: new GraphQLNonNull(UpdateInfo),
            [concreteEntityAdapter.plural]: `[${concreteEntityAdapter.name}!]!`,
        },
        directives: graphqlDirectivesToCompose(propagatedDirectives),
    });
}

// make "helper" types
function makeOptionsInput(
    entityAdapter: ConcreteEntityAdapter | InterfaceEntityAdapter, // required
    composer: SchemaComposer
): InputTypeComposer {
    const optionsInput = composer.createInputTC({
        name: entityAdapter.operations.optionsInputTypeName,
        fields: { limit: GraphQLInt, offset: GraphQLInt },
    });
    return optionsInput;
}
function makeSortFields(
    entityAdapter: ConcreteEntityAdapter | InterfaceEntityAdapter | RelationshipAdapter, // required
    userDefinedFieldDirectives: Map<string, DirectiveNode[]>
): InputTypeComposerFieldConfigMapDefinition {
    const sortFields: InputTypeComposerFieldConfigMapDefinition = {};
    const sortableAttributes = entityAdapter.sortableFields;
    for (const attribute of sortableAttributes) {
        const userDefinedDirectivesOnField = userDefinedFieldDirectives.get(attribute.name) || [];
        const deprecatedDirective = userDefinedDirectivesOnField.filter(
            (directive) => directive.name.value === DEPRECATED
        );
        sortFields[attribute.name] = {
            type: SortDirection,
            directives: graphqlDirectivesToCompose(deprecatedDirective),
        };
    }
    return sortFields;
}
function makeSortInput(
    entityAdapter: ConcreteEntityAdapter | InterfaceEntityAdapter | RelationshipAdapter, // required
    userDefinedFieldDirectives: Map<string, DirectiveNode[]>,
    composer: SchemaComposer
): InputTypeComposer {
    const sortFields = makeSortFields(entityAdapter, userDefinedFieldDirectives);
    const sortInput = composer.createInputTC({
        name: entityAdapter.operations.sortInputTypeName,
        fields: sortFields,
    });
    if (!(entityAdapter instanceof RelationshipAdapter)) {
        sortInput.setDescription(
            `Fields to sort ${entityAdapter.upperFirstPlural} by. The order in which sorts are applied is not guaranteed when specifying many fields in one ${entityAdapter.operations.sortInputTypeName} object.`
        );
    }
    return sortInput;
}
function makeAggregableFields(
    concreteEntity: ConcreteEntityAdapter, // required
    aggregationTypesMapper: AggregationTypesMapper
): ObjectTypeComposerFieldConfigMapDefinition<any, any> {
    const aggregableFields: ObjectTypeComposerFieldConfigMapDefinition<any, any> = {};
    const aggregableAttributes = concreteEntity.aggregableFields;
    for (const attribute of aggregableAttributes) {
        const objectTypeComposer = aggregationTypesMapper.getAggregationType({
            fieldName: attribute.getTypeName(),
            nullable: !attribute.isRequired(),
        });
        if (objectTypeComposer) {
            aggregableFields[attribute.name] = objectTypeComposer.NonNull;
        }
    }
    return aggregableFields;
}
function makeWhereInput(
    entityAdapter: ConcreteEntityAdapter | InterfaceEntityAdapter | UnionEntityAdapter | RelationshipAdapter, // required
    userDefinedFieldDirectives: Map<string, DirectiveNode[]>,
    features: Neo4jFeaturesSettings | undefined,
    composer: SchemaComposer
): InputTypeComposer {
    const whereFields = makeWhereFields(entityAdapter, userDefinedFieldDirectives, features);
    const whereInputType = composer.createInputTC({
        name: entityAdapter.operations.whereInputTypeName,
        fields: whereFields,
    });
    return whereInputType;
}
function makeWhereFields(
    entityAdapter: ConcreteEntityAdapter | InterfaceEntityAdapter | UnionEntityAdapter | RelationshipAdapter, // required
    userDefinedFieldDirectives: Map<string, DirectiveNode[]>,
    features: Neo4jFeaturesSettings | undefined
): InputTypeComposerFieldConfigMapDefinition {
    if (entityAdapter instanceof UnionEntityAdapter) {
        const fields: InputTypeComposerFieldConfigMapDefinition = {};
        for (const concreteEntity of entityAdapter.concreteEntities) {
            fields[concreteEntity.name] = concreteEntity.operations.whereInputTypeName;
        }
        return fields;
    }
    // TODO: make a a category for these including filtering logic from getWhereFieldsForAttributes
    const filterableAttributes = Array.from(entityAdapter.attributes.values());
    return getWhereFieldsForAttributes({
        attributes: filterableAttributes,
        userDefinedFieldDirectives,
        features,
    });
}
function makeCreateInputFields(
    interfaceEntityAdapter: InterfaceEntityAdapter // required
): InputTypeComposerFieldConfigMapDefinition {
    const fields: InputTypeComposerFieldConfigMapDefinition = {};
    for (const entityAdapter of interfaceEntityAdapter.concreteEntities) {
        fields[entityAdapter.name] = {
            type: entityAdapter.operations.createInputTypeName,
        };
    }
    return fields;
}
// TODO: maybe combine implementationsInputTypes creation into one function?
function makeImplementationsWhereInput(
    interfaceEntityAdapter: InterfaceEntityAdapter, // required
    composer: SchemaComposer
): InputTypeComposer {
    const fields: InputTypeComposerFieldConfigMapDefinition = {};
    for (const entityAdapter of interfaceEntityAdapter.concreteEntities) {
        fields[entityAdapter.name] = {
            type: entityAdapter.operations.whereInputTypeName,
        };
    }
    const implementationsWhereType = composer.createInputTC({
        name: interfaceEntityAdapter.operations.whereOnImplementationsWhereInputTypeName,
        fields,
    });
    ensureNonEmptyInput(composer, implementationsWhereType);
    return implementationsWhereType;
}
function makeImplementationsUpdateInput(
    interfaceEntityAdapter: InterfaceEntityAdapter, // required
    composer: SchemaComposer
): InputTypeComposer {
    const fields: InputTypeComposerFieldConfigMapDefinition = {};
    for (const entityAdapter of interfaceEntityAdapter.concreteEntities) {
        fields[entityAdapter.name] = {
            type: entityAdapter.operations.updateInputTypeName,
        };
    }
    const implementationsUpdateType = composer.createInputTC({
        name: interfaceEntityAdapter.operations.whereOnImplementationsUpdateInputTypeName,
        fields,
    });
    ensureNonEmptyInput(composer, implementationsUpdateType);
    return implementationsUpdateType;
}
function makeImplementationsDeleteInput(
    interfaceEntityAdapter: InterfaceEntityAdapter, // required
    composer: SchemaComposer
): InputTypeComposer | undefined {
    const fields: InputTypeComposerFieldConfigMapDefinition = {};
    for (const entityAdapter of interfaceEntityAdapter.concreteEntities) {
        if (entityAdapter.relationships.size) {
            fields[entityAdapter.name] = {
                type: `[${entityAdapter.operations.deleteInputTypeName}!]`,
            };
        }
    }
    if (Object.keys(fields).length) {
        const implementationsDeleteType = composer.createInputTC({
            name: interfaceEntityAdapter.operations.whereOnImplementationsDeleteInputTypeName,
            fields,
        });
        // ensureNonEmptyInput(composer, implementationsDeleteType);
        return implementationsDeleteType;
    }
    return undefined;
}
function makeImplementationsConnectInput(
    interfaceEntityAdapter: InterfaceEntityAdapter, // required
    composer: SchemaComposer
): InputTypeComposer | undefined {
    const fields: InputTypeComposerFieldConfigMapDefinition = {};
    for (const entityAdapter of interfaceEntityAdapter.concreteEntities) {
        if (entityAdapter.relationships.size) {
            fields[entityAdapter.name] = {
                type: `[${entityAdapter.operations.connectInputTypeName}!]`,
            };
        }
    }
    if (Object.keys(fields).length) {
        const implementationsConnectType = composer.createInputTC({
            name: interfaceEntityAdapter.operations.whereOnImplementationsConnectInputTypeName,
            fields,
        });
        // ensureNonEmptyInput(composer, implementationsConnectType);
        return implementationsConnectType;
    }
    return undefined;
}
function makeImplementationsDisconnectInput(
    interfaceEntityAdapter: InterfaceEntityAdapter, // required
    composer: SchemaComposer
): InputTypeComposer | undefined {
    const fields: InputTypeComposerFieldConfigMapDefinition = {};
    for (const entityAdapter of interfaceEntityAdapter.concreteEntities) {
        if (entityAdapter.relationships.size) {
            fields[entityAdapter.name] = {
                type: `[${entityAdapter.operations.disconnectInputTypeName}!]`,
            };
        }
    }
    if (Object.keys(fields).length) {
        const implementationsDisconnectType = composer.createInputTC({
            name: interfaceEntityAdapter.operations.whereOnImplementationsDisconnectInputTypeName,
            fields,
        });
        ensureNonEmptyInput(composer, implementationsDisconnectType);
        return implementationsDisconnectType;
    }
    return undefined;
}

function makeAugmentedSchema(
    document: DocumentNode,
    {
        features,
        generateSubscriptions,
        userCustomResolvers,
        subgraph,
    }: {
        features?: Neo4jFeaturesSettings;
        generateSubscriptions?: boolean;
        userCustomResolvers?: IResolvers | Array<IResolvers>;
        subgraph?: Subgraph;
    } = {},
    schemaModel: Neo4jGraphQLSchemaModel
): {
    nodes: Node[];
    relationships: Relationship[];
    typeDefs: DocumentNode;
    resolvers: IResolvers;
} {
    const composer = new SchemaComposer();
    const callbacks = features?.populatedBy?.callbacks;

    let relationships: Relationship[] = [];

    const definitionNodes = getDefinitionNodes(document);
    const customResolvers = getCustomResolvers(document);
    const {
        interfaceTypes,
        scalarTypes,
        objectTypes,
        enumTypes,
        // inputObjectTypes,
        // directives,
        unionTypes,
        schemaExtensions,
    } = definitionNodes;

    // TODO: use schemaModel.definitionCollection instead of definitionNodes? need to add inputObjectTypes and customResolvers
    const schemaGenerator = new AugmentedSchemaGenerator(
        schemaModel,
        definitionNodes,
        [customResolvers.customQuery, customResolvers.customMutation, customResolvers.customSubscription].filter(
            (x): x is ObjectTypeDefinitionNode => Boolean(x)
        )
    );
    const generatorComposer = schemaGenerator.generate();
    composer.merge(generatorComposer);

    // TODO: move these to SchemaGenerator once nodes are moved (in the meantime references to object types are causing errors because they are not present in the generated schema)
    const pipedDefs = [
        ...definitionNodes.enumTypes,
        ...definitionNodes.scalarTypes,
        ...definitionNodes.inputObjectTypes,
        ...definitionNodes.unionTypes,
        ...definitionNodes.directives,
        ...[customResolvers.customQuery, customResolvers.customMutation, customResolvers.customSubscription].filter(
            (x): x is ObjectTypeDefinitionNode => Boolean(x)
        ),
    ].filter(Boolean);
    if (pipedDefs.length) {
        composer.addTypeDefs(print({ kind: Kind.DOCUMENT, definitions: pipedDefs }));
    }

    // """createSomething"""

    // TODO: move deprecationMap out to separate file eventually
    const deprecationMap = new Map<
        string,
        {
            field: string;
            reason: string;
            deprecatedFromVersion: string;
            toBeRemovedInVersion: string;
        }[]
    >([
        [
            SchemaGeneratorModel.createInfoTypeName,
            [
                {
                    field: "bookmark",
                    reason: "This field has been deprecated because bookmarks are now handled by the driver.",
                    deprecatedFromVersion: "",
                    toBeRemovedInVersion: "",
                },
            ],
        ],
        [
            SchemaGeneratorModel.updateInfoTypeName,
            [
                {
                    field: "bookmark",
                    reason: "This field has been deprecated because bookmarks are now handled by the driver.",
                    deprecatedFromVersion: "",
                    toBeRemovedInVersion: "",
                },
            ],
        ],
        [
            SchemaGeneratorModel.deleteInfoTypeName,
            [
                {
                    field: "bookmark",
                    reason: "This field has been deprecated because bookmarks are now handled by the driver.",
                    deprecatedFromVersion: "",
                    toBeRemovedInVersion: "",
                },
            ],
        ],
    ]);

    // Loop over all entries in the deprecation map and add field deprecations to all types in the map.
    for (const [typeName, deprecatedFields] of deprecationMap) {
        const typeComposer = composer.getOTC(typeName);
        typeComposer.deprecateFields(
            deprecatedFields.reduce((acc, { field, reason }) => ({ ...acc, [field]: reason }), {})
        );
    }

    // TODO: ideally move these in getSubgraphSchema()
    if (subgraph) {
        const shareable = subgraph.getFullyQualifiedDirectiveName("shareable");
        [
            SchemaGeneratorModel.createInfoTypeName,
            SchemaGeneratorModel.updateInfoTypeName,
            SchemaGeneratorModel.deleteInfoTypeName,
            SchemaGeneratorModel.pageInfoTypeName,
        ].forEach((typeName) => {
            const typeComposer = composer.getOTC(typeName);
            typeComposer.setDirectiveByName(shareable);
        });
    }

    const aggregationTypesMapper = new AggregationTypesMapper(composer, subgraph);

    const getNodesResult = getNodes(definitionNodes, { callbacks, userCustomResolvers });

    const { nodes, relationshipPropertyInterfaceNames, interfaceRelationshipNames } = getNodesResult;

    // graphql-compose will break if the Point and CartesianPoint types are created but not used,
    // because it will purge the unused types but leave behind orphaned field resolvers
    //
    // These are flags to check whether the types are used and then create them if they are
    // let { pointInTypeDefs, cartesianPointInTypeDefs } = getNodesResult;

    const hasGlobalNodes = addGlobalNodeFields(nodes, composer);

    const { relationshipProperties, interfaceRelationships, filteredInterfaceTypes } = filterInterfaceTypes(
        interfaceTypes,
        relationshipPropertyInterfaceNames,
        interfaceRelationshipNames
    );

    // TODO: keeping this `relationshipFields` scaffold for backwards compatibility on translation layer
    // actual functional logic is in schemaModel.concreteEntities.forEach
    const relationshipFields = new Map<string, ObjectFields>();
    relationshipProperties.forEach((relationship) => {
        const relFields = getObjFieldMeta({
            enums: enumTypes,
            interfaces: filteredInterfaceTypes,
            objects: objectTypes,
            scalars: scalarTypes,
            unions: unionTypes,
            obj: relationship,
            callbacks,
        });

        relationshipFields.set(relationship.name.value, relFields);
        /*
        const baseFields: BaseField[][] = Object.values(relFields);
        
        const objectComposeFields = objectFieldsToComposeFields(baseFields.reduce((acc, x) => [...acc, ...x], []));
        
        const propertiesInterface = composer.createInterfaceTC({
            name: relationship.name.value,
            fields: objectComposeFields,
        });
        
        composer.createInputTC({
            name: `${relationship.name.value}Sort`,
            fields: propertiesInterface.getFieldNames().reduce((res, f) => {
                return { ...res, [f]: "SortDirection" };
            }, {}),
        });
        
        const relationshipUpdateITC = composer.createInputTC({
            name: `${relationship.name.value}UpdateInput`,
            fields: objectFieldsToUpdateInputFields([
                ...relFields.primitiveFields.filter(
                    (field) => !field.autogenerate && !field.readonly && !field.callback
                    ),
                    ...relFields.scalarFields,
                    ...relFields.enumFields,
                    ...relFields.temporalFields.filter((field) => !field.timestamps),
                    ...relFields.pointFields,
                ]),
        });

        addMathOperatorsToITC(relationshipUpdateITC);
        
        addArrayMethodsToITC(relationshipUpdateITC, relFields.primitiveFields);
        addArrayMethodsToITC(relationshipUpdateITC, relFields.pointFields);
        
        const relationshipWhereFields = getWhereFields({
            typeName: relationship.name.value,
            fields: {
                scalarFields: relFields.scalarFields,
                enumFields: relFields.enumFields,
                temporalFields: relFields.temporalFields,
                pointFields: relFields.pointFields,
                primitiveFields: relFields.primitiveFields,
            },
            features,
        });
        
        composer.createInputTC({
            name: `${relationship.name.value}Where`,
            fields: relationshipWhereFields,
        });
        
        composer.createInputTC({
            name: `${relationship.name.value}CreateInput`,
            fields: objectFieldsToCreateInputFields([
                ...relFields.primitiveFields.filter((field) => !field.autogenerate && !field.callback),
                ...relFields.scalarFields,
                ...relFields.enumFields,
                ...relFields.temporalFields,
                ...relFields.pointFields,
            ]),
        });
        */
    });

    // this is the new "functional" way for the above forEach
    // helper to only create relationshipProperties Interface types once, even if multiple relationships reference it
    const seenRelationshipPropertiesInterfaces = new Set<string>();
    schemaModel.concreteEntities.forEach((concreteEntity) => {
        const concreteEntityAdapter = new ConcreteEntityAdapter(concreteEntity);

        for (const relationship of concreteEntityAdapter.relationships.values()) {
            {
                if (
                    !relationship.propertiesTypeName ||
                    seenRelationshipPropertiesInterfaces.has(relationship.propertiesTypeName)
                ) {
                    continue;
                }
                doForRelationshipPropertiesInterface(composer, relationship, definitionNodes, features);
                seenRelationshipPropertiesInterfaces.add(relationship.propertiesTypeName);
            }
        }
    });

    // TODO: temporary helper to keep track of which interface entities were already "visited"
    const seenInterfaces = new Set<string>();
    interfaceRelationships.forEach((interfaceRelationship) => {
        const interfaceEntity = schemaModel.getEntity(interfaceRelationship.name.value) as InterfaceEntity;
        const interfaceEntityAdapter = new InterfaceEntityAdapter(interfaceEntity);
        const updatedRelationships = doForInterfacesThatAreTargetOfARelationship({
            composer,
            interfaceEntityAdapter,
            definitionNodes,
            subgraph,
            relationships,
            relationshipFields,
        });
        if (updatedRelationships) {
            relationships = updatedRelationships;
        }
        seenInterfaces.add(interfaceRelationship.name.value);
    });

    // TODO: find some solution for this
    // TODO: should directives be inherited?? they are user-defined after all
    // TODO: other considerations might apply to PROPAGATED_DIRECTIVES: deprecated and shareable
    // ATM we only test deprecated propagates
    // also, should these live in the schema model??
    const userDefinedFieldDirectivesForNode = new Map<string, Map<string, DirectiveNode[]>>();
    const userDefinedDirectivesForNode = new Map<string, DirectiveNode[]>();
    const propagatedDirectivesForNode = new Map<string, DirectiveNode[]>();
    const userDefinedDirectivesForInterface = new Map<string, DirectiveNode[]>();
    for (const definitionNode of definitionNodes.objectTypes) {
        const userDefinedObjectDirectives =
            definitionNode.directives?.filter((directive) => !isInArray(OBJECT_DIRECTIVES, directive.name.value)) || [];
        const propagatedDirectives =
            definitionNode.directives?.filter((directive) => isInArray(PROPAGATED_DIRECTIVES, directive.name.value)) ||
            [];
        userDefinedDirectivesForNode.set(definitionNode.name.value, userDefinedObjectDirectives);
        propagatedDirectivesForNode.set(definitionNode.name.value, propagatedDirectives);
        const userDefinedFieldDirectives = getUserDefinedFieldDirectivesForDefinition(definitionNode, definitionNodes);
        userDefinedFieldDirectivesForNode.set(definitionNode.name.value, userDefinedFieldDirectives);
    }
    for (const definitionNode of definitionNodes.interfaceTypes) {
        const userDefinedInterfaceDirectives =
            definitionNode.directives?.filter((directive) => !isInArray(INTERFACE_DIRECTIVES, directive.name.value)) ||
            [];
        userDefinedDirectivesForInterface.set(definitionNode.name.value, userDefinedInterfaceDirectives);
        const userDefinedFieldDirectives = getUserDefinedFieldDirectivesForDefinition(definitionNode, definitionNodes);
        userDefinedFieldDirectivesForNode.set(definitionNode.name.value, userDefinedFieldDirectives);
    }

    schemaModel.concreteEntities.forEach((concreteEntity) => {
        // TODO: temporary for backwards compatibility for translation layer
        const node = nodes.find((n) => n.name === concreteEntity.name);
        if (!node) {
            throw new Error("Fix node not found.");
        }
        const concreteEntityAdapter = new ConcreteEntityAdapter(concreteEntity);

        const userDefinedFieldDirectives = userDefinedFieldDirectivesForNode.get(concreteEntityAdapter.name);
        if (!userDefinedFieldDirectives) {
            throw new Error("fix user directives for object types.");
        }

        const propagatedDirectives = propagatedDirectivesForNode.get(concreteEntity.name) || [];
        const directives = (userDefinedDirectivesForNode.get(concreteEntity.name) || []).concat(propagatedDirectives);
        // const nodeFields = attributeAdapterToComposeFields(
        //     concreteEntityAdapter.objectFields,
        //     userDefinedFieldDirectives
        // );
        // const composeNode = composer.createObjectTC({
        //     name: concreteEntity.name,
        //     fields: nodeFields,
        //     description: concreteEntityAdapter.description,
        //     directives: graphqlDirectivesToCompose(directives),
        //     interfaces: concreteEntity.compositeEntities.filter((e) => e instanceof InterfaceEntity).map((e) => e.name),
        // });
        // if (concreteEntityAdapter.isGlobalNode()) {
        //     composeNode.setField("id", {
        //         type: new GraphQLNonNull(GraphQLID),
        //         resolve: (src) => {
        //             const field = concreteEntityAdapter.globalIdField.name;
        //             const value = src[field] as string | number;
        //             return concreteEntityAdapter.toGlobalId(value.toString());
        //         },
        //     });

        //     composeNode.addInterface("Node");
        // }
        const composeNode = withObjectType(concreteEntityAdapter, userDefinedFieldDirectives, directives, composer);

        // const sortFields = concreteEntityAdapter.sortableFields.reduce(
        //     (res: InputTypeComposerFieldConfigMapDefinition, attributeAdapter) => {
        //         // TODO: make a nicer way of getting these user defined field directives
        //         const userDefinedDirectivesOnField = userDefinedFieldDirectives.get(attributeAdapter.name) || [];
        //         return {
        //             ...res,
        //             [attributeAdapter.name]: {
        //                 type: "SortDirection",
        //                 directives: graphqlDirectivesToCompose(
        //                     userDefinedDirectivesOnField.filter((directive) => directive.name.value === DEPRECATED)
        //                 ),
        //             },
        //         };
        //     },
        //     {}
        // );
        // if (Object.keys(sortFields).length) {
        //     const sortInput = composer.createInputTC({
        //         name: concreteEntityAdapter.operations.sortInputTypeName,
        //         fields: sortFields,
        //         description: `Fields to sort ${concreteEntityAdapter.upperFirstPlural} by. The order in which sorts are applied is not guaranteed when specifying many fields in one ${concreteEntityAdapter.operations.sortInputTypeName} object.`,
        //     });

        //     composer.createInputTC({
        //         name: concreteEntityAdapter.operations.optionsInputTypeName,
        //         fields: {
        //             sort: {
        //                 description: `Specify one or more ${concreteEntityAdapter.operations.sortInputTypeName} objects to sort ${concreteEntityAdapter.upperFirstPlural} by. The sorts will be applied in the order in which they are arranged in the array.`,
        //                 type: sortInput.NonNull.List,
        //             },
        //             limit: "Int",
        //             offset: "Int",
        //         },
        //     });
        // } else {
        //     composer.createInputTC({
        //         name: concreteEntityAdapter.operations.optionsInputTypeName,
        //         fields: { limit: "Int", offset: "Int" },
        //     });
        // }

        withOptionsInputType(concreteEntityAdapter, userDefinedFieldDirectives, composer);

        // composer.createObjectTC({
        //     name: concreteEntityAdapter.operations.aggregateTypeNames.selection,
        //     fields: {
        //         count: {
        //             type: "Int!",
        //             resolve: numericalResolver,
        //             args: {},
        //         },
        //         ...concreteEntityAdapter.aggregableFields.reduce((res, field) => {
        //             const objectTypeComposer = aggregationTypesMapper.getAggregationType({
        //                 fieldName: field.getTypeName(),
        //                 nullable: !field.isRequired(),
        //             });

        //             if (objectTypeComposer) {
        //                 res[field.name] = objectTypeComposer.NonNull;
        //             }

        //             return res;
        //         }, {}),
        //     },
        //     directives: graphqlDirectivesToCompose(propagatedDirectives),
        // });

        withAggregateSelectionType(concreteEntityAdapter, aggregationTypesMapper, propagatedDirectives, composer);

        // START WHERE FIELD -------------------

        // const queryFields = getWhereFieldsFromConcreteEntity({
        //     concreteEntityAdapter,
        //     userDefinedFieldDirectives,
        //     features,
        // });
        // composer.createInputTC({
        //     name: concreteEntityAdapter.operations.whereInputTypeName,
        //     fields: concreteEntityAdapter.isGlobalNode() ? { id: "ID", ...queryFields } : queryFields,
        // });

        withWhereInputType(concreteEntityAdapter, userDefinedFieldDirectives, features, composer);

        // TODO: new way
        // TODO: Need to migrate resolvers, which themselves rely on the translation layer being migrated to the new schema model
        augmentFulltextSchema2(node, composer, concreteEntityAdapter);

        // composer.createInputTC({
        //     name: `${concreteEntityAdapter.name}UniqueWhere`,
        //     fields: concreteEntityAdapter.uniqueFields.reduce((res, field) => {
        //         return {
        //             [field.name]: field.getFieldTypeName(),
        //             ...res,
        //         };
        //     }, {}),
        // });
        withUniqueWhereInputType(concreteEntityAdapter, composer);

        // END WHERE FIELD -------------------

        // composer.createInputTC({
        //     name: concreteEntityAdapter.operations.createInputTypeName,
        //     fields: concreteEntityToCreateInputFields(
        //         concreteEntityAdapter.createInputFields,
        //         userDefinedFieldDirectives
        //     ),
        // });

        withCreateInputType(concreteEntityAdapter, userDefinedFieldDirectives, composer);

        // const nodeUpdateITC = composer.createInputTC({
        //     name: concreteEntityAdapter.operations.updateMutationArgumentNames.update,
        //     fields: concreteEntityToUpdateInputFields(
        //         concreteEntityAdapter.updateInputFields,
        //         userDefinedFieldDirectives
        //     ),
        // });
        // addMathOperatorsToITC(nodeUpdateITC);
        // addArrayMethodsToITC2(nodeUpdateITC, concreteEntityAdapter.arrayMethodFields);
        withUpdateInputType(concreteEntityAdapter, userDefinedFieldDirectives, composer);

        // composer.createObjectTC({
        //     name: concreteEntityAdapter.operations.mutationResponseTypeNames.create,
        //     fields: {
        //         info: `CreateInfo!`,
        //         [concreteEntityAdapter.plural]: `[${concreteEntityAdapter.name}!]!`,
        //     },
        //     directives: graphqlDirectivesToCompose(propagatedDirectives),
        // });

        // composer.createObjectTC({
        //     name: concreteEntityAdapter.operations.mutationResponseTypeNames.update,
        //     fields: {
        //         info: `UpdateInfo!`,
        //         [concreteEntityAdapter.plural]: `[${concreteEntityAdapter.name}!]!`,
        //     },
        //     directives: graphqlDirectivesToCompose(propagatedDirectives),
        // });
        withMutationResponseTypes(concreteEntityAdapter, propagatedDirectives, composer);

        // createRelationshipFields({
        // relationshipFields: node.relationFields,
        // concreteEntityAdapter,
        // schemaComposer: composer,
        // composeNode,
        // sourceName: concreteEntityAdapter.name,
        // nodes,
        // relationshipPropertyFields: relationshipFields,
        // subgraph,
        // });

        createRelationshipFieldsFromConcreteEntityAdapter({
            entityAdapter: concreteEntityAdapter,
            schemaComposer: composer,
            composeNode,
            subgraph,
            userDefinedFieldDirectives,
        });

        // relationships = [
        //     ...relationships,
        //     ...createConnectionFields({
        //         connectionFields: node.connectionFields,
        //         schemaComposer: composer,
        //         composeNode,
        //         sourceName: concreteEntityAdapter.name,
        //         nodes,
        //         relationshipPropertyFields: relationshipFields,
        //     }),
        // ];

        relationships = [
            ...relationships,
            ...createConnectionFields2({
                entityAdapter: concreteEntityAdapter,
                schemaComposer: composer,
                composeNode,
                userDefinedFieldDirectives,
                relationshipFields,
            }),
        ];

        ensureNonEmptyInput(composer, concreteEntityAdapter.operations.updateInputTypeName);
        ensureNonEmptyInput(composer, concreteEntityAdapter.operations.createInputTypeName);

        if (concreteEntityAdapter.isReadable) {
            composer.Query.addFields({
                [concreteEntityAdapter.operations.rootTypeFieldNames.read]: findResolver2({
                    node,
                    concreteEntityAdapter,
                }),
            });
            composer.Query.setFieldDirectives(
                concreteEntityAdapter.operations.rootTypeFieldNames.read,
                graphqlDirectivesToCompose(propagatedDirectives)
            );
            composer.Query.addFields({
                [`${concreteEntityAdapter.plural}Connection`]: rootConnectionResolver2({
                    node,
                    composer,
                    concreteEntityAdapter,
                    propagatedDirectives,
                }),
            });
            composer.Query.setFieldDirectives(
                `${concreteEntityAdapter.plural}Connection`,
                graphqlDirectivesToCompose(propagatedDirectives)
            );
        }
        if (concreteEntityAdapter.isAggregable) {
            composer.Query.addFields({
                [concreteEntityAdapter.operations.rootTypeFieldNames.aggregate]: aggregateResolver2({
                    node,
                    concreteEntityAdapter,
                }),
            });
            composer.Query.setFieldDirectives(
                concreteEntityAdapter.operations.rootTypeFieldNames.aggregate,
                graphqlDirectivesToCompose(propagatedDirectives)
            );
        }

        if (concreteEntityAdapter.isCreatable) {
            composer.Mutation.addFields({
                [concreteEntityAdapter.operations.rootTypeFieldNames.create]: createResolver2({
                    node,
                    concreteEntityAdapter,
                }),
            });
            composer.Mutation.setFieldDirectives(
                concreteEntityAdapter.operations.rootTypeFieldNames.create,
                graphqlDirectivesToCompose(propagatedDirectives)
            );
        }

        if (concreteEntityAdapter.isDeletable) {
            composer.Mutation.addFields({
                [concreteEntityAdapter.operations.rootTypeFieldNames.delete]: deleteResolver2({
                    node,
                    composer,
                    concreteEntityAdapter,
                }),
            });
            composer.Mutation.setFieldDirectives(
                concreteEntityAdapter.operations.rootTypeFieldNames.delete,
                graphqlDirectivesToCompose(propagatedDirectives)
            );
        }

        if (concreteEntityAdapter.isUpdatable) {
            composer.Mutation.addFields({
                [concreteEntityAdapter.operations.rootTypeFieldNames.update]: updateResolver2({
                    node,
                    composer,
                    concreteEntityAdapter,
                }),
            });
            composer.Mutation.setFieldDirectives(
                concreteEntityAdapter.operations.rootTypeFieldNames.update,
                graphqlDirectivesToCompose(propagatedDirectives)
            );
        }
    });

    schemaModel.compositeEntities.forEach((entity) => {
        if (entity instanceof UnionEntity) {
            withWhereInputType(new UnionEntityAdapter(entity), new Map<string, DirectiveNode[]>(), features, composer);
            return;
        }
        if (entity instanceof InterfaceEntity && !seenInterfaces.has(entity.name)) {
            const definitionNode = definitionNodes.interfaceTypes.find((type) => type.name.value === entity.name);

            if (!definitionNode) {
                console.error(`Definition node not found for ${entity.name}`);
                return;
            }

            const interfaceEntityAdapter = new InterfaceEntityAdapter(entity);
            // composer.createInterfaceTC({
            //     name: interfaceEntityAdapter.name,
            //     description: interfaceEntity.description,
            //     fields: {
            //         ...attributeAdapterToComposeFields(
            //             Array.from(interfaceEntityAdapter.attributes.values()),
            //             getUserDefinedFieldDirectivesForDefinition(inter, definitionNodes)
            //         ),
            //         ...relationshipAdapterToComposeFields(
            //             Array.from(interfaceEntityAdapter.relationships.values()),
            //             getUserDefinedFieldDirectivesForDefinition(inter, definitionNodes)
            //         ),
            //     },
            //     directives: graphqlDirectivesToCompose(
            //         userDefinedDirectivesForInterface.get(interfaceEntity.name) || []
            //     ),
            // });

            const userDefinedFieldDirectives = getUserDefinedFieldDirectivesForDefinition(
                definitionNode,
                definitionNodes
            );
            const directives = userDefinedDirectivesForInterface.get(entity.name) || [];
            withInterfaceType(interfaceEntityAdapter, userDefinedFieldDirectives, directives, composer, {
                includeRelationships: true,
            });
            return;
        }
        return;
    });

    if (generateSubscriptions && nodes.length) {
        // generateSubscriptionTypes({
        //     schemaComposer: composer,
        //     nodes,
        //     relationshipFields,
        //     interfaceCommonFields,
        //     globalSchemaConfiguration,
        // });
        generateSubscriptionTypes2({
            schemaComposer: composer,
            schemaModel,
            userDefinedFieldDirectivesForNode,
        });
    }

    // TODO: test this - toplevel cypher fields of type Point?
    ["Mutation", "Query"].forEach((type) => {
        const objectComposer: ObjectTypeComposer = composer[type];

        const operation: Operation | undefined = schemaModel.operations[type];
        if (!operation) {
            return;
        }
        const operationAdapter = new OperationAdapter(operation);

        const definitionNode = definitionNodes.operations.find(
            (d) => d.name.value === type
        ) as ObjectTypeDefinitionNode;
        const userDefinedDirectives = getUserDefinedFieldDirectivesForDefinition(definitionNode, definitionNodes);

        // TODO: this check is for getObjFieldMeta
        // this should technically be implied. TBD in Operations class
        const hasCypherAttributes = Array.from(operationAdapter.attributes.values()).find(
            (attribute) => attribute.annotations.cypher !== undefined
        );
        if (!hasCypherAttributes) {
            return;
        }
        // needed for compatibility with translation layer
        const objectFields = getObjFieldMeta({
            obj: customResolvers[`customCypher${type}`],
            scalars: scalarTypes,
            enums: enumTypes,
            interfaces: filteredInterfaceTypes,
            unions: unionTypes,
            objects: objectTypes,
            callbacks,
        });

        // TODO: extend this loop to do the non-cypher field logic as well
        for (const attributeAdapter of operationAdapter.attributes.values()) {
            const cypherAnnotation = attributeAdapter.annotations.cypher;
            if (cypherAnnotation) {
                // needed for compatibility with translation layer
                const field = objectFields.cypherFields.find(
                    (f) => f.fieldName === attributeAdapter.name
                ) as CypherField;
                const customResolver = cypherResolver2({
                    field,
                    attributeAdapter,
                    type: type as "Query" | "Mutation",
                });

                const composedField = attributeAdapterToComposeFields([attributeAdapter], userDefinedDirectives)[
                    attributeAdapter.name
                ];

                objectComposer.addFields({ [attributeAdapter.name]: { ...composedField, ...customResolver } });
            }
        }
    });

    if (!Object.values(composer.Mutation.getFields()).length) {
        composer.delete("Mutation");
    }
    //  TODO: why is this now needed?
    if (!Object.values(composer.Subscription.getFields()).length) {
        composer.delete("Subscription");
    }

    const generatedTypeDefs = composer.toSDL();

    let parsedDoc = parse(generatedTypeDefs);

    const emptyObjectsInterfaces = parsedDoc.definitions
        .filter(
            (x): x is InterfaceTypeDefinitionNode | ObjectTypeDefinitionNode =>
                (x.kind === Kind.OBJECT_TYPE_DEFINITION && !isRootType(x)) || x.kind === Kind.INTERFACE_TYPE_DEFINITION
        )
        .filter((x) => !x.fields?.length);

    if (emptyObjectsInterfaces.length) {
        throw new Error(
            `Objects and Interfaces must have one or more fields: ${emptyObjectsInterfaces
                .map((x) => x.name.value)
                .join(", ")}`
        );
    }

    const documentNames = new Set(parsedDoc.definitions.filter(definitionNodeHasName).map((x) => x.name.value));
    const resolveMethods = getResolveAndSubscriptionMethods(composer);

    const generatedResolveMethods: Record<string, any> = {};

    for (const [key, value] of Object.entries(resolveMethods)) {
        if (documentNames.has(key)) {
            generatedResolveMethods[key] = value;
        }
    }

    const generatedResolvers = {
        ...generatedResolveMethods,
        ...Object.values(Scalars).reduce((res, scalar: GraphQLScalarType) => {
            if (generatedTypeDefs.includes(`scalar ${scalar.name}\n`)) {
                res[scalar.name] = scalar;
            }
            return res;
        }, {}),
        ...(hasGlobalNodes ? { Node: { __resolveType: (root) => root.__resolveType } } : {}),
    };

    unionTypes.forEach((union) => {
        // It is possible to make union types "writeonly". In this case adding a resolver for them breaks schema generation.
        const unionTypeInSchema = parsedDoc.definitions.find((def) => {
            if (def.kind === Kind.UNION_TYPE_DEFINITION && def.name.value === union.name.value) return true;
            return false;
        });
        if (!generatedResolvers[union.name.value] && unionTypeInSchema) {
            generatedResolvers[union.name.value] = { __resolveType: (root) => root.__resolveType };
        }
    });

    interfaceRelationships.forEach((i) => {
        if (!generatedResolvers[i.name.value]) {
            generatedResolvers[i.name.value] = { __resolveType: (root) => root.__resolveType };
        }
    });

    // do not propagate Neo4jGraphQL directives on schema extensions
    const schemaExtensionsWithoutNeo4jDirectives = schemaExtensions.map((schemaExtension): SchemaExtensionNode => {
        return {
            kind: schemaExtension.kind,
            loc: schemaExtension.loc,
            operationTypes: schemaExtension.operationTypes,
            directives: schemaExtension.directives?.filter(
                (schemaDirective) =>
                    !["query", "mutation", "subscription", "authentication"].includes(schemaDirective.name.value)
            ),
        };
    });
    const seen = {};
    parsedDoc = {
        ...parsedDoc,
        definitions: [
            ...parsedDoc.definitions.filter((definition) => {
                // Filter out default scalars, they are not needed and can cause issues
                if (definition.kind === Kind.SCALAR_TYPE_DEFINITION) {
                    if (["Boolean", "Float", "ID", "Int", "String"].includes(definition.name.value)) {
                        return false;
                    }
                }

                if (!("name" in definition)) {
                    return true;
                }

                const n = definition.name?.value as string;

                if (seen[n]) {
                    return false;
                }

                seen[n] = n;

                return true;
            }),
            ...schemaExtensionsWithoutNeo4jDirectives,
        ],
    };

    return {
        nodes,
        relationships,
        typeDefs: parsedDoc,
        resolvers: generatedResolvers,
    };
}

export default makeAugmentedSchema;

function doForRelationshipPropertiesInterface(
    composer: SchemaComposer,
    relationship: RelationshipAdapter,
    definitionNodes: DefinitionNodes,
    features?: Neo4jFeaturesSettings
) {
    if (!relationship.propertiesTypeName) {
        return;
    }

    const obj = definitionNodes.interfaceTypes.find((i) => i.name.value === relationship.propertiesTypeName);
    if (!obj) {
        throw new Error(`Could not find interface named ${relationship.propertiesTypeName}`);
    }

    const userDefinedFieldDirectives = getUserDefinedFieldDirectivesForDefinition(obj, definitionNodes);

    // const composeFields = attributeAdapterToComposeFields(
    //     Array.from(relationship.attributes.values()),
    //     userDefinedFieldDirectives
    // );

    // const propertiesInterface = composer.createInterfaceTC({
    //     name: relationship.propertiesTypeName,
    //     fields: composeFields,
    // });

    withInterfaceType(relationship, userDefinedFieldDirectives, [], composer);

    // composer.createInputTC({
    //     name: relationship.operations.sortInputTypeName,
    //     fields: propertiesInterface.getFieldNames().reduce((res, f) => {
    //         return { ...res, [f]: "SortDirection" };
    //     }, {}),
    // });
    withSortInputType(relationship, userDefinedFieldDirectives, composer);

    // const relationshipUpdateITC = composer.createInputTC({
    //     name: relationship.operations.edgeUpdateInputTypeName,
    //     // better name for this fn pls - we are using interface entity now.
    //     fields: concreteEntityToUpdateInputFields(relationship.updateInputFields, userDefinedFieldDirectives),
    // });
    // addMathOperatorsToITC(relationshipUpdateITC);
    // addArrayMethodsToITC2(relationshipUpdateITC, relationship.arrayMethodFields);
    withUpdateInputType(relationship, userDefinedFieldDirectives, composer);

    // const relationshipWhereFields = getWhereFieldsFromRelationshipProperties({
    //     relationshipAdapter: relationship,
    //     userDefinedFieldDirectives,
    //     features,
    // });

    // composer.createInputTC({
    //     name: relationship.operations.whereInputTypeName,
    //     fields: relationshipWhereFields,
    // });
    withWhereInputType(relationship, userDefinedFieldDirectives, features, composer);

    // composer.createInputTC({
    //     // name: `${relationship.propertiesTypeName}CreateInput`,
    //     name: relationship.operations.createInputTypeName,
    //     fields: concreteEntityToCreateInputFields(relationship.createInputFields, userDefinedFieldDirectives),
    // });
    withCreateInputType(relationship, userDefinedFieldDirectives, composer);
}

function doForInterfacesThatAreTargetOfARelationship({
    composer,
    interfaceEntityAdapter,
    definitionNodes,
    features,
    subgraph,
    relationships,
    relationshipFields,
}: {
    composer: SchemaComposer;
    interfaceEntityAdapter: InterfaceEntityAdapter;
    definitionNodes: DefinitionNodes;
    features?: Neo4jFeaturesSettings;
    subgraph?: Subgraph;
    relationships: Relationship[];
    relationshipFields: Map<string, ObjectFields>;
}) {
    // We wanted to get the userDefinedDirectives
    const definitionNode = definitionNodes.interfaceTypes.find(
        (type) => type.name.value === interfaceEntityAdapter.name
    );
    if (!definitionNode) {
        console.error(`Definition node not found for ${interfaceEntityAdapter.name}`);
        return;
    }

    const userDefinedFieldDirectives = getUserDefinedFieldDirectivesForDefinition(definitionNode, definitionNodes);

    // const objectComposeFields = attributeAdapterToComposeFields(
    //     Array.from(interfaceEntityAdapter.attributes.values()),
    //     userDefinedFieldDirectives
    // );
    // const composeInterface = composer.createInterfaceTC({
    //     name: interfaceEntityAdapter.name,
    //     fields: objectComposeFields,
    // });

    const composeInterface = withInterfaceType(interfaceEntityAdapter, userDefinedFieldDirectives, [], composer);

    // const interfaceOptionsInput = composer.getOrCreateITC(`${interfaceEntityAdapter.name}Options`, (tc) => {
    //     tc.addFields({
    //         limit: "Int",
    //         offset: "Int",
    //     });
    // });
    // const interfaceSortableFields = interfaceEntityAdapter.sortableFields.reduce(
    //     (res: InputTypeComposerFieldConfigMapDefinition, attributeAdapter) => {
    //         const userDefinedDirectivesOnField = userDefinedFieldDirectives.get(attributeAdapter.name) || [];
    //         return {
    //             ...res,
    //             [attributeAdapter.name]: {
    //                 type: "SortDirection",
    //                 directives: graphqlDirectivesToCompose(
    //                     userDefinedDirectivesOnField.filter((directive) => directive.name.value === DEPRECATED)
    //                 ),
    //             },
    //         };
    //     },
    //     {}
    // );
    // if (Object.keys(interfaceSortableFields).length) {
    //     const interfaceSortInput = composer.getOrCreateITC(`${interfaceEntityAdapter.name}Sort`, (tc) => {
    //         tc.addFields(interfaceSortableFields);
    //         tc.setDescription(
    //             `Fields to sort ${pluralize(
    //                 interfaceEntityAdapter.name
    //             )} by. The order in which sorts are applied is not guaranteed when specifying many fields in one ${`${interfaceEntityAdapter.name}Sort`} object.`
    //         );
    //     });
    //     interfaceOptionsInput.addFields({
    //         sort: {
    //             description: `Specify one or more ${`${interfaceEntityAdapter.name}Sort`} objects to sort ${pluralize(
    //                 interfaceEntityAdapter.name
    //             )} by. The sorts will be applied in the order in which they are arranged in the array.`,
    //             type: interfaceSortInput.List,
    //         },
    //     });
    // }

    withOptionsInputType(interfaceEntityAdapter, userDefinedFieldDirectives, composer);

    // const [
    // implementationsConnectInput,
    // implementationsDeleteInput,
    // implementationsDisconnectInput,
    // implementationsUpdateInput,
    // implementationsWhereInput,
    // ] = ["ConnectInput", "DisconnectInput", "DeleteInput", "UpdateInput", "Where"].map((suffix) =>
    //     composer.createInputTC({
    //         name: `${interfaceEntityAdapter.name}Implementations${suffix}`,
    //         fields: {},
    //     })
    // ) as [InputTypeComposer, InputTypeComposer, InputTypeComposer, InputTypeComposer, InputTypeComposer];

    // const interfaceWhereFields = getWhereFieldsForAttributes({
    //     attributes: Array.from(interfaceEntityAdapter.attributes.values()),
    //     userDefinedFieldDirectives,
    //     features,
    // });
    // composer.createInputTC({
    //     name: interfaceEntityAdapter.operations.whereInputTypeName,
    //     fields: { ...interfaceWhereFields, _on: implementationsWhereInput },
    // });

    withWhereInputType(interfaceEntityAdapter, userDefinedFieldDirectives, features, composer);

    // const interfaceCreateInput = composer.createInputTC(`${interfaceEntityAdapter.name}CreateInput`);

    withCreateInputType(interfaceEntityAdapter, userDefinedFieldDirectives, composer);

    // const interfaceRelationshipITC = composer.getOrCreateITC(`${interfaceEntityAdapter.name}UpdateInput`, (tc) => {
    //     tc.addFields({
    //         ...concreteEntityToUpdateInputFields(interfaceEntityAdapter.updateInputFields, userDefinedFieldDirectives),
    //         _on: implementationsUpdateInput,
    //     });
    // });
    // addMathOperatorsToITC(interfaceRelationshipITC);
    withUpdateInputType(interfaceEntityAdapter, userDefinedFieldDirectives, composer);

    createRelationshipFieldsFromConcreteEntityAdapter({
        entityAdapter: interfaceEntityAdapter,
        schemaComposer: composer,
        composeNode: composeInterface,
        subgraph,
        userDefinedFieldDirectives,
    });

    relationships = [
        ...relationships,
        ...createConnectionFields2({
            entityAdapter: interfaceEntityAdapter,
            schemaComposer: composer,
            composeNode: composeInterface,
            userDefinedFieldDirectives,
            relationshipFields,
        }),
    ];

    // interfaceEntityAdapter.concreteEntities.forEach((implementation) => {
    // implementationsWhereInput.addFields({
    //     [implementation.name]: {
    //         type: `${implementation.name}Where`,
    //     },
    // });

    // if (implementation.relationships.size) {
    //     implementationsConnectInput.addFields({
    //         [implementation.name]: {
    //             type: `[${implementation.name}ConnectInput!]`,
    //         },
    //     });

    // implementationsDeleteInput.addFields({
    //     [implementation.name]: {
    //         type: `[${implementation.name}DeleteInput!]`,
    //     },
    // });

    // implementationsDisconnectInput.addFields({
    //     [implementation.name]: {
    //         type: `[${implementation.name}DisconnectInput!]`,
    //     },
    // });
    // }

    // interfaceCreateInput.addFields({
    //     [implementation.name]: {
    //         type: `${implementation.name}CreateInput`,
    //     },
    // });

    // implementationsUpdateInput.addFields({
    //     [implementation.name]: {
    //         type: `${implementation.name}UpdateInput`,
    //     },
    // });
    // });

    // if (implementationsConnectInput.getFieldNames().length) {
    //     const interfaceConnectInput = composer.getOrCreateITC(`${interfaceEntityAdapter.name}ConnectInput`, (tc) => {
    //         tc.addFields({ _on: implementationsConnectInput });
    //     });
    //     interfaceConnectInput.setField("_on", implementationsConnectInput);
    // }

    // if (implementationsDeleteInput.getFieldNames().length) {
    //     const interfaceDeleteInput = composer.getOrCreateITC(`${interfaceEntityAdapter.name}DeleteInput`, (tc) => {
    //         tc.addFields({ _on: implementationsDeleteInput });
    //     });
    //     interfaceDeleteInput.setField("_on", implementationsDeleteInput);
    // }

    // if (implementationsDisconnectInput.getFieldNames().length) {
    //     const interfaceDisconnectInput = composer.getOrCreateITC(
    //         `${interfaceEntityAdapter.name}DisconnectInput`,
    //         (tc) => {
    //             tc.addFields({ _on: implementationsDisconnectInput });
    //         }
    //     );
    //     interfaceDisconnectInput.setField("_on", implementationsDisconnectInput);
    // }

    withDeleteInputType(interfaceEntityAdapter, composer);
    withConnectInputType(interfaceEntityAdapter, composer);
    withDisconnectInputType(interfaceEntityAdapter, composer);

    ensureNonEmptyInput(composer, `${interfaceEntityAdapter.name}CreateInput`);
    ensureNonEmptyInput(composer, `${interfaceEntityAdapter.name}UpdateInput`);
    // [
    // implementationsConnectInput,
    // implementationsDeleteInput,
    // implementationsDisconnectInput,
    // implementationsUpdateInput,
    // implementationsWhereInput,
    // ].forEach((c) => ensureNonEmptyInput(composer, c));

    return relationships;
}
