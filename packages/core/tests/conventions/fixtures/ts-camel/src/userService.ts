export function getUserById(id: string) {
  return { id }
}

export function createUser(name: string, email: string) {
  const userId = generateId()
  const userRecord = { id: userId, name, email }
  return userRecord
}

export function updateUserEmail(userId: string, newEmail: string) {
  const existingUser = findUser(userId)
  return { ...existingUser, email: newEmail }
}

function generateId() {
  return Math.random().toString(36).slice(2)
}

function findUser(id: string) {
  return { id }
}

export class UserService {
  private readonly dbClient: unknown

  constructor(dbClient: unknown) {
    this.dbClient = dbClient
  }

  fetchUser(userId: string) {
    return { userId }
  }

  saveUser(userData: Record<string, string>) {
    return userData
  }
}
