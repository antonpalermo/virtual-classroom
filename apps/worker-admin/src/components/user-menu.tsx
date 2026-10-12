import { Avatar, AvatarFallback } from '@capstone/ui/components/avatar'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from '@capstone/ui/components/dropdown-menu'
import { signOut } from '../lib/auth-client'

export function UserMenu({ email }: { email: string }) {
    return (
        <DropdownMenu>
            <DropdownMenuTrigger aria-label="User menu" className="rounded-full">
                <Avatar>
                    <AvatarFallback>{email.charAt(0).toUpperCase()}</AvatarFallback>
                </Avatar>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-auto">
                <DropdownMenuGroup>
                    <DropdownMenuLabel>{email}</DropdownMenuLabel>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={signOut}>Sign out</DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
