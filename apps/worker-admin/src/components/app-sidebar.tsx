import { Sidebar, SidebarContent, SidebarGroup, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '@capstone/ui/components/sidebar'
import { Link, useLocation } from '@tanstack/react-router'

export function AppSidebar() {
    const pathname = useLocation({ select: location => location.pathname })

    return (
        <Sidebar variant="inset">
            <SidebarContent>
                <SidebarGroup>
                    <SidebarMenu>
                        <SidebarMenuItem>
                            <SidebarMenuButton isActive={pathname === '/users'} render={<Link to="/users" />}>
                                Users
                            </SidebarMenuButton>
                        </SidebarMenuItem>
                    </SidebarMenu>
                </SidebarGroup>
            </SidebarContent>
        </Sidebar>
    )
}
