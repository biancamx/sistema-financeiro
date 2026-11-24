import { ZodError } from 'zod';

// Valida body/query/params com zod e substitui pelo valor já convertido.
export const validate = (schemas) => (req, _res, next) => {
  try {
    for (const [part, schema] of Object.entries(schemas)) {
      if (!schema) continue;
      const input = req[part];
      let objectSchema = schema;
      while (objectSchema?._def?.type === 'pipe') objectSchema = objectSchema._def.in;
      const shape = objectSchema?.shape;
      if (shape && input && typeof input === 'object' && !Array.isArray(input)) {
        const unknownKeys = Object.keys(input).filter((key) => !Object.hasOwn(shape, key));
        if (unknownKeys.length) {
          throw new ZodError([{
            code: 'unrecognized_keys',
            keys: unknownKeys,
            path: [],
            message: `Campo(s) não permitido(s): ${unknownKeys.join(', ')}`,
          }]);
        }
      }
      req[part] = schema.parse(input);
    }
    next();
  } catch (e) {
    next(e);
  }
};
