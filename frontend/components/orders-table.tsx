"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Order } from "@/lib/api-client";
import { formatCurrency, formatDateTime } from "@/lib/format-utils";

import { useState } from "react";
import { TickerDisplay } from "./ticker-display";

interface OrdersTableProps {
  orders: Order[];
  isLoading: boolean;
  onNavigate: (symbol: string) => void;
  tickerIcons: Record<string, string | null | undefined>;
}

type SortKey = keyof Order;
type SortDirection = "asc" | "desc";

export function OrdersTable({ orders, isLoading, onNavigate, tickerIcons }: OrdersTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>("time_placed");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDirection("desc"); // Default to desc for new columns (usually better for numbers/dates)
    }
  };

  const sortedOrders = [...orders].sort((a, b) => {
    const aVal = a[sortKey];
    const bVal = b[sortKey];

    if (aVal === bVal) return 0;
    if (aVal === undefined || aVal === null) return 1;
    if (bVal === undefined || bVal === null) return -1;

    if (sortDirection === "asc") {
      return aVal < bVal ? -1 : 1;
    } else {
      return aVal > bVal ? -1 : 1;
    }
  });

  const SortIcon = ({ column }: { column: SortKey }) => {
    if (sortKey !== column) return <span className="opacity-0 group-hover:opacity-30 ml-1">↕</span>;
    return <span className="ml-1 text-orange-400">{sortDirection === "asc" ? "↑" : "↓"}</span>;
  };

  const HeaderCell = ({ column, label, align = "left" }: { column: SortKey, label: string, align?: "left" | "right" }) => (
    <TableHead 
      className={`text-neutral-400 cursor-pointer hover:text-white transition-colors group select-none ${align === "right" ? "text-right" : ""}`}
      onClick={() => handleSort(column)}
    >
      <div className={`flex items-center ${align === "right" ? "justify-end" : ""}`}>
        {label}
        <SortIcon column={column} />
      </div>
    </TableHead>
  );

  if (isLoading) {
    return (
      <div className="flex justify-center items-center py-8 text-neutral-400">
        Loading orders...
      </div>
    );
  }

  if (orders.length === 0) {
    return (
      <div className="flex justify-center items-center py-8 text-neutral-400">
        No orders found for today.
      </div>
    );
  }

  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case "filled":
        return "bg-green-500/10 text-green-500 hover:bg-green-500/20";
      case "cancelled":
        return "bg-red-500/10 text-red-500 hover:bg-red-500/20";
      case "working":
      case "submitted":
        return "bg-blue-500/10 text-blue-500 hover:bg-blue-500/20";
      case "pending":
        return "bg-yellow-500/10 text-yellow-500 hover:bg-yellow-500/20";
      default:
        return "bg-neutral-500/10 text-neutral-500 hover:bg-neutral-500/20";
    }
  };

  return (
    <div className="rounded-md border border-neutral-800 bg-neutral-900/50">
      <Table>
        <TableHeader>
          <TableRow className="border-neutral-800 hover:bg-transparent">
            <HeaderCell column="time_placed" label="Time" />
            <HeaderCell column="symbol" label="Symbol" />
            <HeaderCell column="action" label="Action" />
            <HeaderCell column="quantity" label="Qty" align="right" />
            <HeaderCell column="filled_quantity" label="Filled" align="right" />
            <HeaderCell column="limit_price" label="Price" align="right" />
            <HeaderCell column="average_fill_price" label="Avg Fill" align="right" />
            <HeaderCell column="status" label="Status" />
            <HeaderCell column="order_id" label="ID" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortedOrders.map((order) => (
            <TableRow 
              key={order.order_id} 
              className="border-neutral-800 hover:bg-neutral-800/50 cursor-pointer"
              onClick={() => onNavigate(order.symbol)}
            >
              <TableCell className="font-mono text-xs text-neutral-400 whitespace-nowrap">
                {order.time_placed ? (
                  <div className="flex flex-col">
                    <span>{formatDateTime(order.time_placed, true).split(' ')[0]} {formatDateTime(order.time_placed, true).split(' ')[1]}</span>
                    <span className="text-neutral-600">{formatDateTime(order.time_placed, true).split(' ').slice(2).join(' ')}</span>
                  </div>
                ) : "-"}
              </TableCell>
              <TableCell className="font-medium text-neutral-200">
                <div className="flex flex-col">
                  <div className="flex items-center gap-2">
                    <TickerDisplay 
                      symbol={order.symbol} 
                      iconUrl={tickerIcons[order.symbol]} 
                    />
                    {order.asset_type === "option" && (
                      <Badge variant="outline" className="text-xs border-neutral-700 bg-neutral-800 text-neutral-400 h-5 px-1.5 font-normal">
                        OPT
                      </Badge>
                    )}
                  </div>
                  {order.asset_type === "option" && order.strike && order.expiry && (
                    <div className="text-xs text-neutral-500 mt-1 flex gap-2">
                        <span className={order.option_type === "call" ? "text-green-500/70" : "text-red-500/70"}>
                          {order.strike} {order.option_type === "call" ? "C" : "P"}
                        </span>
                        <span>{order.expiry}</span>
                    </div>
                  )}
                </div>
              </TableCell>
              <TableCell>
                <span className={order.action === "BUY" ? "text-green-400" : "text-red-400"}>
                  {order.action}
                </span>
              </TableCell>
              <TableCell className="text-right text-neutral-300">
                {order.quantity}
              </TableCell>
              <TableCell className="text-right text-neutral-300">
                {order.filled_quantity}
              </TableCell>
              <TableCell className="text-right text-neutral-300">
                {order.order_type === "MARKET" ? "MKT" : formatCurrency(order.limit_price || 0)}
              </TableCell>
              <TableCell className="text-right text-neutral-300">
                {order.average_fill_price ? formatCurrency(order.average_fill_price) : "-"}
              </TableCell>
              <TableCell>
                <Badge variant="outline" className={`border-0 ${getStatusColor(order.status)}`}>
                  {order.status}
                </Badge>
              </TableCell>
              <TableCell className="font-mono text-xs text-neutral-500 truncate max-w-[100px]" title={order.order_id}>
                {order.order_id}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
