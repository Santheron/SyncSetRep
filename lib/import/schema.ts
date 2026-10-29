export const IMPORT_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  additionalProperties: false,
  required: ['programName', 'days', 'warnings'],
  properties: {
    programName: { $ref: '#/$defs/textField' },
    days: {
      type: 'array',
      maxItems: 16,
      items: { $ref: '#/$defs/day' },
    },
    warnings: {
      type: 'array',
      items: { type: 'string', maxLength: 200 },
    },
  },
  $defs: {
    textField: {
      type: 'object',
      additionalProperties: false,
      required: ['origin', 'value'],
      properties: {
        origin: { enum: ['extracted', 'missing'] },
        value: { type: ['string', 'null'], maxLength: 2000 },
      },
    },
    setsField: {
      anyOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: ['origin', 'value', 'suggestion'],
          properties: {
            origin: { const: 'extracted' },
            value: { type: 'integer', minimum: 1, maximum: 12 },
            suggestion: { type: 'null' },
          },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['origin', 'value', 'suggestion'],
          properties: {
            origin: { const: 'missing' },
            value: { type: 'null' },
            suggestion: {
              anyOf: [
                { type: 'integer', minimum: 1, maximum: 12 },
                { type: 'null' },
              ],
            },
          },
        },
      ],
    },
    restField: {
      anyOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: ['origin', 'value', 'suggestion'],
          properties: {
            origin: { const: 'extracted' },
            value: { type: 'integer', minimum: 0, maximum: 600 },
            suggestion: { type: 'null' },
          },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['origin', 'value', 'suggestion'],
          properties: {
            origin: { const: 'missing' },
            value: { type: 'null' },
            suggestion: {
              anyOf: [
                { type: 'integer', minimum: 0, maximum: 600 },
                { type: 'null' },
              ],
            },
          },
        },
      ],
    },
    weightField: {
      type: 'object',
      additionalProperties: false,
      required: ['origin', 'value', 'suggestion'],
      properties: {
        origin: { enum: ['extracted', 'missing'] },
        value: {
          anyOf: [{ type: 'number' }, { type: 'string', maxLength: 40 }, { type: 'null' }],
        },
        suggestion: { type: 'null' },
      },
    },
    repExtracted: {
      type: 'object',
      additionalProperties: false,
      required: ['origin', 'value', 'suggestion'],
      properties: {
        origin: { const: 'extracted' },
        value: { type: 'integer', minimum: 1, maximum: 100 },
        suggestion: { type: 'null' },
      },
    },
    repMissing: {
      type: 'object',
      additionalProperties: false,
      required: ['origin', 'value', 'suggestion'],
      properties: {
        origin: { const: 'missing' },
        value: { type: 'null' },
        suggestion: {
          anyOf: [
            { type: 'integer', minimum: 1, maximum: 100 },
            { type: 'null' },
          ],
        },
      },
    },
    day: {
      type: 'object',
      additionalProperties: false,
      required: ['name', 'subtitle', 'exercises'],
      properties: {
        name: { $ref: '#/$defs/textField' },
        subtitle: { $ref: '#/$defs/textField' },
        exercises: {
          type: 'array',
          maxItems: 24,
          items: { $ref: '#/$defs/exercise' },
        },
      },
    },
    exercise: {
      anyOf: [{ $ref: '#/$defs/exerciseRepsExtracted' }, { $ref: '#/$defs/exerciseRepsMissing' }],
    },
    exerciseRepsExtracted: {
      type: 'object',
      additionalProperties: false,
      required: ['sourceName', 'sets', 'repsMin', 'repsMax', 'restSeconds', 'weight', 'notes'],
      properties: {
        sourceName: { type: 'string', maxLength: 2000 },
        sets: { $ref: '#/$defs/setsField' },
        repsMin: { $ref: '#/$defs/repExtracted' },
        repsMax: { $ref: '#/$defs/repExtracted' },
        restSeconds: { $ref: '#/$defs/restField' },
        weight: { $ref: '#/$defs/weightField' },
        notes: { $ref: '#/$defs/textField' },
      },
    },
    exerciseRepsMissing: {
      type: 'object',
      additionalProperties: false,
      required: ['sourceName', 'sets', 'repsMin', 'repsMax', 'restSeconds', 'weight', 'notes'],
      properties: {
        sourceName: { type: 'string', maxLength: 2000 },
        sets: { $ref: '#/$defs/setsField' },
        repsMin: { $ref: '#/$defs/repMissing' },
        repsMax: { $ref: '#/$defs/repMissing' },
        restSeconds: { $ref: '#/$defs/restField' },
        weight: { $ref: '#/$defs/weightField' },
        notes: { $ref: '#/$defs/textField' },
      },
    },
  },
} as const;
