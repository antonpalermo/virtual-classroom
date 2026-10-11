import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@capstone/ui/components/table'
import { type ColumnDef, FlexRender, type RowData, tableFeatures, useTable } from '@tanstack/react-table'

// Core features only (no sorting/filtering/pagination yet) — add them here when a table needs them.
const features = tableFeatures({})

export type DataTableColumn<TData extends RowData> = ColumnDef<typeof features, TData>

interface DataTableProps<TData extends RowData> {
    columns: DataTableColumn<TData>[]
    data: TData[]
    getRowId?: (row: TData) => string
}

export function DataTable<TData extends RowData>({ columns, data, getRowId }: DataTableProps<TData>) {
    const table = useTable({ features, columns, data, getRowId })

    return (
        <div className="overflow-hidden rounded-md border">
            <Table>
                <TableHeader>
                    {table.getHeaderGroups().map(headerGroup => (
                        <TableRow key={headerGroup.id}>
                            {headerGroup.headers.map(header => (
                                <TableHead key={header.id}>{header.isPlaceholder ? null : <FlexRender header={header} />}</TableHead>
                            ))}
                        </TableRow>
                    ))}
                </TableHeader>
                <TableBody>
                    {table.getRowModel().rows.map(row => (
                        <TableRow key={row.id}>
                            {row.getAllCells().map(cell => (
                                <TableCell key={cell.id}>
                                    <FlexRender cell={cell} />
                                </TableCell>
                            ))}
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </div>
    )
}
