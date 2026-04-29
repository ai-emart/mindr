import { describe, it, expect } from 'vitest'
import { getUserById, createUser } from '../src/userService.js'

describe('userService', () => {
  it('returns user by id', () => {
    expect(getUserById('123')).toEqual({ id: '123' })
  })

  it('creates a user', () => {
    const user = createUser('Alice', 'alice@example.com')
    expect(user.name).toBe('Alice')
  })
})
