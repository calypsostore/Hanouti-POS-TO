import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatTnd } from '../lib/format';
import { getLanguage, t } from '../i18n';

interface PeakHour {
  hour: number;
  orders: number;
}

interface LabeledSales {
  label: string;
  sales: number;
}

interface HourlySales {
  hour: number;
  sales: number;
}

interface NamedSales {
  name: string;
  sales: number;
}

function formatHour(hour: number): string {
  return new Date(2000, 0, 1, hour).toLocaleTimeString(getLanguage(), { hour: 'numeric' });
}

export function PeakHoursChart({ data }: { data: PeakHour[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ left: 0, right: 8, top: 8, bottom: 8 }}>
        <CartesianGrid stroke="#E6EBF7" vertical={false} />
        <XAxis dataKey="hour" tick={{ fontSize: 10 }} interval={2} tickFormatter={(hour) => formatHour(Number(hour))} />
        <YAxis allowDecimals={false} width={28} tick={{ fontSize: 10 }} />
        <Tooltip labelFormatter={(hour) => formatHour(Number(hour))} />
        <Bar dataKey="orders" name={t('reportsPage.orders')} fill="#3B82F6" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function DashboardSalesByDateChart({ data }: { data: LabeledSales[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ left: 0, right: 12, top: 8, bottom: 8 }}>
        <CartesianGrid stroke="#E6EBF7" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 10 }} minTickGap={20} />
        <YAxis width={48} tick={{ fontSize: 10 }} />
        <Tooltip formatter={(value) => [`${formatTnd(Number(value))} DT`, t('reportsPage.sales')]} />
        <Bar dataKey="sales" name={t('reportsPage.sales')} fill="#F8A81A" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function DashboardSalesByStaffChart({ data }: { data: NamedSales[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ left: 0, right: 12, top: 8, bottom: 8 }}>
        <CartesianGrid stroke="#E6EBF7" vertical={false} />
        <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} />
        <YAxis tick={{ fontSize: 11 }} />
        <Tooltip formatter={(value) => [`${formatTnd(Number(value))} DT`, t('reportsPage.sales')]} />
        <Bar dataKey="sales" name={t('reportsPage.sales')} fill="#2FA878" radius={[6, 6, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function ReportSalesByDayChart({ data }: { data: LabeledSales[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ left: 0, right: 8, top: 8, bottom: 4 }}>
        <CartesianGrid stroke="#E1ECEE" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 10 }} minTickGap={20} />
        <YAxis width={42} tick={{ fontSize: 10 }} />
        <Tooltip formatter={(value) => [`${formatTnd(Number(value))} DT`, t('reportsPage.sales')]} />
        <Line type="monotone" dataKey="sales" name={t('reportsPage.sales')} stroke="#0F5F6E" strokeWidth={2} dot={{ r: 2 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function ReportSalesByHourChart({ data }: { data: HourlySales[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ left: 0, right: 4, top: 8, bottom: 4 }}>
        <CartesianGrid stroke="#E1ECEE" vertical={false} />
        <XAxis dataKey="hour" tick={{ fontSize: 9 }} interval={2} tickFormatter={(hour) => formatHour(Number(hour))} />
        <YAxis width={42} tick={{ fontSize: 10 }} />
        <Tooltip
          labelFormatter={(hour) => formatHour(Number(hour))}
          formatter={(value) => [`${formatTnd(Number(value))} DT`, t('reportsPage.sales')]}
        />
        <Bar dataKey="sales" name={t('reportsPage.sales')} fill="#0F5F6E" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
