import { describe, expect, it } from 'vitest'
import { adminRole, managerRole, userRole } from '../src/access-control'

const allUserActions = ['create', 'list', 'set-role', 'ban', 'impersonate', 'delete', 'set-password', 'set-email', 'get', 'update'] as const

const allSessionActions = ['list', 'revoke', 'delete'] as const

describe('access-control roles', () => {
    it('lets admin perform every user and session action', () => {
        for (const action of allUserActions) {
            expect(adminRole.authorize({ user: [action] }).success).toBe(true)
        }
        for (const action of allSessionActions) {
            expect(adminRole.authorize({ session: [action] }).success).toBe(true)
        }
    })

    it('gives manager the exact same user and session grants as admin', () => {
        for (const action of allUserActions) {
            expect(managerRole.authorize({ user: [action] }).success).toBe(true)
        }
        for (const action of allSessionActions) {
            expect(managerRole.authorize({ session: [action] }).success).toBe(true)
        }
    })

    it('gives user no admin-plugin permissions', () => {
        expect(userRole.authorize({ user: ['list'] }).success).toBe(false)
        expect(userRole.authorize({ user: ['set-role'] }).success).toBe(false)
    })
})
