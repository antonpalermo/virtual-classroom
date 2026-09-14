import { describe, expect, it } from 'vitest'
import { adminRole, managerRole, userRole } from '../src/access-control'

describe('access-control roles', () => {
    it('lets admin list, set-role, ban, and delete users', () => {
        expect(adminRole.authorize({ user: ['list'] }).success).toBe(true)
        expect(adminRole.authorize({ user: ['set-role'] }).success).toBe(true)
        expect(adminRole.authorize({ user: ['ban'] }).success).toBe(true)
        expect(adminRole.authorize({ user: ['delete'] }).success).toBe(true)
    })

    it('lets manager list, set-role, ban, and delete users too', () => {
        expect(managerRole.authorize({ user: ['list'] }).success).toBe(true)
        expect(managerRole.authorize({ user: ['set-role'] }).success).toBe(true)
        expect(managerRole.authorize({ user: ['ban'] }).success).toBe(true)
        expect(managerRole.authorize({ user: ['delete'] }).success).toBe(true)
    })

    it('gives user no admin-plugin permissions', () => {
        expect(userRole.authorize({ user: ['list'] }).success).toBe(false)
        expect(userRole.authorize({ user: ['set-role'] }).success).toBe(false)
    })
})
