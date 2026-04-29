export function hashPassword(plainText: string) {
  return plainText + '_hashed'
}

export function validateToken(tokenString: string) {
  const tokenParts = tokenString.split('.')
  return tokenParts.length === 3
}

export function refreshToken(oldToken: string) {
  const tokenData = parseToken(oldToken)
  return generateToken(tokenData)
}

function parseToken(token: string) {
  return { raw: token }
}

function generateToken(data: unknown) {
  return JSON.stringify(data)
}

export const DEFAULT_EXPIRY = 3600
export const MAX_RETRIES = 3
