'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import Link from 'next/link'
import { Loader2, RefreshCw, Download, Users, Wallet } from 'lucide-react'

interface Payment {
  id: string
  user_id: string | null
  email: string
  amount: number
  currency: string
  status: string
  provider: string | null
  external_id: string | null
  description: string | null
  created_at: string
}

const STATUS_LABELS: Record<string, string> = {
  succeeded: 'Прошла', pending: 'В ожидании', refunded: 'Возврат', failed: 'Ошибка',
}
const STATUS_COLORS: Record<string, string> = {
  succeeded: 'bg-green-500/10 text-green-500 border-green-400/20',
  pending: 'bg-blue-500/10 text-blue-400 border-blue-400/20',
  refunded: 'bg-amber-500/10 text-amber-500 border-amber-400/20',
  failed: 'bg-red-500/10 text-red-400 border-red-400/20',
}

const fmtDate = (d: string | null): string =>
  d ? new Date(d).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'
const fmtMoney = (a: number, c: string): string =>
  `${new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(a)} ${c}`

export default function AdminPaymentsPage() {
  const [payments, setPayments] = useState<Payment[]>([])
  const [loading, setLoading]   = useState(true)
  const [total, setTotal]       = useState(0)
  const [exporting, setExporting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/admin/payments')
    const data = await res.json()
    if (res.ok) {
      setPayments(data.payments)
      setTotal(data.total ?? data.payments.length)
    } else if (res.status === 403) {
      toast.error('Доступ только для администратора')
    } else {
      toast.error(`Ошибка: ${data.error || res.status}`)
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const handleExport = async () => {
    setExporting(true)
    try {
      const res = await fetch('/api/admin/payments?all=1')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Ошибка загрузки')
      const rows = (data.payments as Payment[]) || []
      const aoa: (string | number)[][] = [
        ['Дата', 'Пользователь', 'Сумма', 'Валюта', 'Статус', 'Провайдер', 'ID платежа', 'Описание'],
      ]
      for (const p of rows) {
        aoa.push([
          fmtDate(p.created_at),
          p.email || (p.user_id ?? ''),
          p.amount,
          p.currency,
          STATUS_LABELS[p.status] || p.status,
          p.provider ?? '',
          p.external_id ?? '',
          p.description ?? '',
        ])
      }
      const { downloadXlsx } = await import('@/lib/utils/xlsxTable')
      await downloadXlsx('Оплаты AMA', 'Оплаты', aoa)
      toast.success(`Выгружено ${rows.length} оплат`)
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Ошибка выгрузки')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Оплаты</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Платежи пользователей (пользователь, дата, сумма)</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/admin/users">
            <Button variant="outline" size="sm"><Users className="h-4 w-4 mr-2" /> Пользователи</Button>
          </Link>
          <Button variant="outline" size="sm" onClick={handleExport} disabled={exporting}
            className="border-green-500/30 text-green-600 hover:bg-green-500/10">
            {exporting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
            В Excel
          </Button>
          <Button variant="outline" size="sm" onClick={load}>
            <RefreshCw className="h-4 w-4 mr-2" /> Обновить
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="animate-spin h-8 w-8 text-primary" /></div>
      ) : payments.length === 0 ? (
        <Card className="p-10 text-center">
          <Wallet className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
          <p className="font-medium">Оплат пока нет</p>
          <p className="text-sm text-muted-foreground mt-1 max-w-sm mx-auto">
            Приём платежей ещё не активирован (Prodamus спит). Как только оплаты пойдут, они появятся здесь —
            и выгрузятся в Excel.
          </p>
        </Card>
      ) : (
        <div className="space-y-2">
          {payments.map(p => (
            <Card key={p.id} className="px-4 py-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm truncate">{p.email || '—'}</span>
                  <Badge variant="outline" className={`text-[11px] px-1.5 py-0 ${STATUS_COLORS[p.status] || STATUS_COLORS.succeeded}`}>
                    {STATUS_LABELS[p.status] || p.status}
                  </Badge>
                  {p.provider && <span className="text-[11px] text-muted-foreground">{p.provider}</span>}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {fmtDate(p.created_at)}{p.description ? ` · ${p.description}` : ''}
                </div>
              </div>
              <div className="font-semibold text-sm shrink-0">{fmtMoney(p.amount, p.currency)}</div>
            </Card>
          ))}
        </div>
      )}

      <p className="text-xs text-muted-foreground text-center pb-4">
        Показано {payments.length}{total > payments.length ? ` из ${total}` : ''} оплат
        {total > payments.length && ' · выгрузи в Excel, чтобы увидеть все'}
      </p>
    </div>
  )
}
