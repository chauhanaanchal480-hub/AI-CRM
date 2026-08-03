type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

interface RouteDescription {
  path: string;
  method: HttpMethod;
  tag: string;
  summary: string;
  public?: boolean;
  idempotency?: boolean;
}

const routes: RouteDescription[] = [
  { path: '/', method: 'get', tag: 'System', summary: 'Describe the API', public: true },
  { path: '/auth/register', method: 'post', tag: 'Authentication', summary: 'Register an account', public: true },
  { path: '/auth/login', method: 'post', tag: 'Authentication', summary: 'Authenticate an account', public: true },
  { path: '/auth/mfa/verify', method: 'post', tag: 'Authentication', summary: 'Complete an MFA login challenge', public: true },
  { path: '/auth/forgot-password', method: 'post', tag: 'Authentication', summary: 'Request a password reset', public: true },
  { path: '/auth/reset-password', method: 'post', tag: 'Authentication', summary: 'Complete a password reset', public: true },
  { path: '/auth/refresh', method: 'post', tag: 'Authentication', summary: 'Rotate a refresh token', public: true },
  { path: '/auth/logout', method: 'post', tag: 'Authentication', summary: 'End authenticated sessions' },
  { path: '/auth/me', method: 'get', tag: 'Authentication', summary: 'Get the current user' },
  { path: '/auth/sessions', method: 'get', tag: 'Authentication', summary: 'List active sessions' },
  { path: '/auth/login-history', method: 'get', tag: 'Authentication', summary: 'List login history' },
  { path: '/auth/mfa/status', method: 'get', tag: 'Authentication', summary: 'Get MFA status' },
  { path: '/auth/trusted-devices', method: 'get', tag: 'Authentication', summary: 'List trusted devices' },
  { path: '/auth/step-up', method: 'post', tag: 'Authentication', summary: 'Verify a step-up factor' },
  { path: '/users', method: 'get', tag: 'Users', summary: 'List users' },
  { path: '/users/me', method: 'patch', tag: 'Users', summary: 'Update the current user', idempotency: true },
  { path: '/users/me/password', method: 'post', tag: 'Users', summary: 'Change the current password', idempotency: true },
  { path: '/users/{id}', method: 'patch', tag: 'Users', summary: 'Update a user role', idempotency: true },
  { path: '/customers', method: 'get', tag: 'Customers', summary: 'List customers' },
  { path: '/customers', method: 'post', tag: 'Customers', summary: 'Create a customer', idempotency: true },
  { path: '/customers/{id}', method: 'get', tag: 'Customers', summary: 'Get a customer' },
  { path: '/customers/{id}', method: 'patch', tag: 'Customers', summary: 'Update a customer', idempotency: true },
  { path: '/customers/{id}', method: 'delete', tag: 'Customers', summary: 'Delete a customer', idempotency: true },
  { path: '/leads', method: 'get', tag: 'Leads', summary: 'List leads' },
  { path: '/leads', method: 'post', tag: 'Leads', summary: 'Create a lead', idempotency: true },
  { path: '/leads/{id}', method: 'get', tag: 'Leads', summary: 'Get a lead' },
  { path: '/leads/{id}', method: 'patch', tag: 'Leads', summary: 'Update a lead', idempotency: true },
  { path: '/leads/{id}', method: 'delete', tag: 'Leads', summary: 'Delete a lead', idempotency: true },
  { path: '/leads/{id}/convert', method: 'post', tag: 'Leads', summary: 'Convert a lead', idempotency: true },
  { path: '/deals/board', method: 'get', tag: 'Deals', summary: 'Get the deal board' },
  { path: '/deals', method: 'post', tag: 'Deals', summary: 'Create a deal', idempotency: true },
  { path: '/deals/{id}', method: 'get', tag: 'Deals', summary: 'Get a deal' },
  { path: '/deals/{id}', method: 'patch', tag: 'Deals', summary: 'Update a deal', idempotency: true },
  { path: '/deals/{id}', method: 'delete', tag: 'Deals', summary: 'Delete a deal', idempotency: true },
  { path: '/deals/{id}/move', method: 'patch', tag: 'Deals', summary: 'Move a deal between stages', idempotency: true },
  { path: '/tasks', method: 'get', tag: 'Tasks', summary: 'List tasks' },
  { path: '/tasks', method: 'post', tag: 'Tasks', summary: 'Create a task', idempotency: true },
  { path: '/tasks/{id}', method: 'get', tag: 'Tasks', summary: 'Get a task' },
  { path: '/tasks/{id}', method: 'patch', tag: 'Tasks', summary: 'Update a task', idempotency: true },
  { path: '/tasks/{id}', method: 'delete', tag: 'Tasks', summary: 'Delete a task', idempotency: true },
  { path: '/analytics/dashboard', method: 'get', tag: 'Analytics', summary: 'Get dashboard analytics' },
  { path: '/analytics/deals-by-stage', method: 'get', tag: 'Analytics', summary: 'Get deal stage analytics' },
  { path: '/analytics/revenue-trend', method: 'get', tag: 'Analytics', summary: 'Get revenue trend analytics' },
  { path: '/analytics/leads-by-source', method: 'get', tag: 'Analytics', summary: 'Get lead source analytics' },
  { path: '/notifications', method: 'get', tag: 'Notifications', summary: 'List notifications' },
  { path: '/export/{entity}/excel', method: 'get', tag: 'Exports', summary: 'Export entity data as Excel' },
  { path: '/export/{entity}/pdf', method: 'get', tag: 'Exports', summary: 'Export entity data as PDF' },
  { path: '/audit', method: 'get', tag: 'Audit', summary: 'Query audit events' },
];

const parameterComponents = {
  IdempotencyKey: {
    name: 'Idempotency-Key',
    in: 'header',
    required: false,
    description: 'Unique key for safely replaying this write operation for 24 hours.',
    schema: { type: 'string', minLength: 8, maxLength: 128 },
  },
};

function operation(route: RouteDescription) {
  const operationId = `${route.method}_${route.path}`
    .replace(/[{}]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
  return {
    operationId,
    tags: [route.tag],
    summary: route.summary,
    security: route.public ? [] : [{
      bearerAuth: [],
      hmacKeyId: [],
      hmacSignature: [],
      hmacTimestamp: [],
      hmacNonce: [],
    }],
    ...(route.idempotency ? { parameters: [{ $ref: '#/components/parameters/IdempotencyKey' }] } : {}),
    responses: {
      '200': { description: 'Successful response' },
      '400': { $ref: '#/components/responses/BadRequest' },
      '401': { $ref: '#/components/responses/Unauthorized' },
      '403': { $ref: '#/components/responses/Forbidden' },
      '429': { $ref: '#/components/responses/TooManyRequests' },
      default: { $ref: '#/components/responses/Error' },
    },
  };
}

const paths: Record<string, Record<string, unknown>> = {};
for (const route of routes) {
  paths[route.path] ??= {};
  paths[route.path][route.method] = operation(route);
}

export const openApiDocument = {
  openapi: '3.1.0',
  info: {
    title: 'AI-CRM Enterprise API',
    version: '1.0.0',
    description: 'Versioned AI-CRM API. Bearer authentication remains required for protected resources. HMAC signing can additionally enforce request integrity and replay protection.',
  },
  servers: [{ url: '/api/v1', description: 'Canonical version 1 API' }],
  tags: [...new Set(routes.map((route) => route.tag))].map((name) => ({ name })),
  security: [{ bearerAuth: [] }],
  paths,
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      hmacKeyId: { type: 'apiKey', in: 'header', name: 'X-API-Key-Id' },
      hmacSignature: { type: 'apiKey', in: 'header', name: 'X-API-Signature' },
      hmacTimestamp: { type: 'apiKey', in: 'header', name: 'X-API-Timestamp' },
      hmacNonce: { type: 'apiKey', in: 'header', name: 'X-API-Nonce' },
    },
    parameters: parameterComponents,
    schemas: {
      Error: {
        type: 'object',
        required: ['success', 'error'],
        properties: {
          success: { type: 'boolean', const: false },
          error: {
            type: 'object',
            required: ['message'],
            properties: { message: { type: 'string' }, details: { type: 'object', additionalProperties: true } },
          },
        },
      },
    },
    responses: {
      BadRequest: { description: 'Invalid request', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
      Unauthorized: { description: 'Authentication or request signature failed', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
      Forbidden: { description: 'The caller is not permitted to perform the operation', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
      TooManyRequests: { description: 'Request rate or abuse threshold exceeded', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
      Error: { description: 'Error response', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
    },
  },
  'x-hmac-signing': {
    algorithm: 'HMAC-SHA256',
    canonicalPayload: 'METHOD\\nPATH_WITH_SORTED_QUERY\\nUNIX_TIMESTAMP\\nNONCE\\nSHA256_CANONICAL_BODY',
    multipartCanonicalBody: 'JSON({fields:[[SORTED_NAME,VALUE]],files:[{fieldName,filename,contentType,sha256}]})',
    maximumClockSkewSeconds: 300,
    replayProtection: 'Each key ID and nonce pair may be used only once.',
  },
};
