import { useState, useRef, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Mail, Phone, Globe, MapPin, Pencil, StickyNote, Send, Paperclip,
  Trash2, DollarSign, Download, Clock,
} from 'lucide-react';
import { formatDistanceToNow, format } from 'date-fns';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge, customerStatusTone, dealStatusTone } from '@/components/ui/Badge';
import { Avatar } from '@/components/ui/Avatar';
import { Textarea } from '@/components/ui/Textarea';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { FullPageSpinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { AiAssistantCard } from '@/components/customers/AiAssistantCard';
import { ActivityTimeline } from '@/components/customers/ActivityTimeline';
import { CustomerFormModal } from '@/components/customers/CustomerFormModal';
import { useCustomer } from '@/hooks/useCustomers';
import { useAddNote, useDeleteNote, useUploadFile, useLogEmail } from '@/hooks/useInteractions';
import { useAuthStore } from '@/store/authStore';
import { formatCurrency } from '@/lib/utils';

type Tab = 'timeline' | 'notes' | 'emails' | 'deals' | 'files';
const tabs: { key: Tab; label: string }[] = [
  { key: 'timeline', label: 'Timeline' },
  { key: 'notes', label: 'Notes' },
  { key: 'emails', label: 'Emails' },
  { key: 'deals', label: 'Deals' },
  { key: 'files', label: 'Files' },
];

export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: customer, isLoading } = useCustomer(id);
  const [tab, setTab] = useState<Tab>('timeline');
  const [noteBody, setNoteBody] = useState('');
  const [editOpen, setEditOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const currentUser = useAuthStore((s) => s.user);
  const [emailForm, setEmailForm] = useState<{
    direction: 'INBOUND' | 'OUTBOUND';
    subject: string;
    body: string;
    toAddr: string;
    fromAddr: string;
  }>({ direction: 'OUTBOUND', subject: '', body: '', toAddr: '', fromAddr: '' });

  const addNote = useAddNote(id!);
  const deleteNote = useDeleteNote(id!);
  const uploadFile = useUploadFile(id!);
  const logEmail = useLogEmail(id!);

  // Prefill the compose form's addresses once the customer/user are loaded,
  // without clobbering anything the user has already typed.
  useEffect(() => {
    setEmailForm((f) => ({
      ...f,
      toAddr: f.toAddr || customer?.email || '',
      fromAddr: f.fromAddr || currentUser?.email || '',
    }));
  }, [customer?.email, currentUser?.email]);

  if (isLoading) return <FullPageSpinner label="Loading customer…" />;
  if (!customer) {
    return (
      <EmptyState
        title="Customer not found"
        action={<Button onClick={() => navigate('/app/customers')}>Back to customers</Button>}
      />
    );
  }

  const submitNote = async () => {
    if (!noteBody.trim()) return;
    await addNote.mutateAsync(noteBody.trim());
    setNoteBody('');
  };

  // Swapping direction also swaps sender/recipient (inbound = customer → us).
  const setEmailDirection = (direction: 'INBOUND' | 'OUTBOUND') =>
    setEmailForm((f) => ({ ...f, direction, toAddr: f.fromAddr, fromAddr: f.toAddr }));

  const emailReady = Boolean(
    emailForm.subject.trim() && emailForm.body.trim() && emailForm.toAddr.trim() && emailForm.fromAddr.trim(),
  );

  const submitEmail = async () => {
    if (!emailReady) return;
    await logEmail.mutateAsync({
      direction: emailForm.direction,
      subject: emailForm.subject.trim(),
      body: emailForm.body.trim(),
      toAddr: emailForm.toAddr.trim(),
      fromAddr: emailForm.fromAddr.trim(),
    });
    setEmailForm((f) => ({ ...f, subject: '', body: '' }));
  };

  return (
    <div>
      <Link to="/app/customers" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to customers
      </Link>

      <PageHeader
        title={customer.name}
        actions={<Button variant="outline" onClick={() => setEditOpen(true)}><Pencil className="h-4 w-4" /> Edit</Button>}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left column: profile + AI */}
        <div className="space-y-6">
          <Card>
            <CardContent className="pt-5">
              <div className="flex items-center gap-4">
                <Avatar firstName={customer.name.split(' ')[0]} lastName={customer.name.split(' ')[1]} src={customer.avatarUrl} size="lg" />
                <div className="min-w-0">
                  <p className="truncate text-lg font-semibold text-foreground">{customer.name}</p>
                  {customer.company && <p className="text-sm text-muted-foreground">{customer.company}</p>}
                  <Badge tone={customerStatusTone[customer.status]} className="mt-1.5">{customer.status}</Badge>
                </div>
              </div>

              <div className="mt-5 space-y-2.5 text-sm">
                {customer.email && <InfoRow icon={Mail} value={customer.email} href={`mailto:${customer.email}`} />}
                {customer.phone && <InfoRow icon={Phone} value={customer.phone} href={`tel:${customer.phone}`} />}
                {customer.website && <InfoRow icon={Globe} value={customer.website} href={customer.website} />}
                {(customer.city || customer.country) && (
                  <InfoRow icon={MapPin} value={[customer.city, customer.country].filter(Boolean).join(', ')} />
                )}
                <InfoRow icon={Clock} value={`Added ${format(new Date(customer.createdAt), 'MMM d, yyyy')}`} />
              </div>

              {customer.tags.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {customer.tags.map((t) => <Badge key={t} tone="muted">#{t}</Badge>)}
                </div>
              )}

              {customer.owner && (
                <div className="mt-4 flex items-center gap-2 border-t border-border pt-4">
                  <Avatar firstName={customer.owner.firstName} lastName={customer.owner.lastName} src={customer.owner.avatarUrl} size="xs" />
                  <p className="text-xs text-muted-foreground">
                    Owned by <span className="font-medium text-foreground">{customer.owner.firstName} {customer.owner.lastName}</span>
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          <AiAssistantCard customerId={customer.id} latestSummary={customer.insights?.find((i) => i.kind === 'SUMMARY')} />
        </div>

        {/* Right column: tabs */}
        <div className="lg:col-span-2">
          <Card>
            <div className="flex gap-1 overflow-x-auto border-b border-border px-3 pt-3">
              {tabs.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={`relative whitespace-nowrap px-3 py-2 text-sm font-medium transition-colors ${
                    tab === t.key ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {t.label}
                  {t.key === 'deals' && customer.deals.length > 0 && (
                    <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px]">{customer.deals.length}</span>
                  )}
                  {tab === t.key && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary" />}
                </button>
              ))}
            </div>

            <CardContent className="pt-5">
              {tab === 'timeline' && <ActivityTimeline activities={customer.activities} />}

              {tab === 'notes' && (
                <div className="space-y-4">
                  <div className="flex flex-col gap-2">
                    <Textarea placeholder="Add a note about this customer…" value={noteBody} onChange={(e) => setNoteBody(e.target.value)} />
                    <div className="flex justify-end">
                      <Button size="sm" onClick={submitNote} loading={addNote.isPending} disabled={!noteBody.trim()}>
                        <StickyNote className="h-4 w-4" /> Add note
                      </Button>
                    </div>
                  </div>
                  {!customer.customerNotes.length ? (
                    <EmptyState icon={StickyNote} title="No notes yet" />
                  ) : (
                    <div className="space-y-3">
                      {customer.customerNotes.map((n) => (
                        <div key={n.id} className="group rounded-xl border border-border bg-card/40 p-3">
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-sm text-foreground">{n.body}</p>
                            <button onClick={() => deleteNote.mutate(n.id)} className="opacity-0 transition-opacity group-hover:opacity-100">
                              <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-danger" />
                            </button>
                          </div>
                          <p className="mt-1.5 text-xs text-muted-foreground">
                            {n.user ? `${n.user.firstName} ${n.user.lastName} · ` : ''}
                            {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {tab === 'emails' && (
                <div className="space-y-4">
                  {/* Compose / log an email against this customer */}
                  <div className="space-y-2 rounded-xl border border-border bg-card/40 p-3">
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                      <Select
                        aria-label="Direction"
                        value={emailForm.direction}
                        onChange={(e) => setEmailDirection(e.target.value as 'INBOUND' | 'OUTBOUND')}
                        options={[
                          { value: 'OUTBOUND', label: 'Outbound' },
                          { value: 'INBOUND', label: 'Inbound' },
                        ]}
                      />
                      <Input
                        aria-label="From address"
                        type="email"
                        placeholder="From"
                        value={emailForm.fromAddr}
                        onChange={(e) => setEmailForm((f) => ({ ...f, fromAddr: e.target.value }))}
                      />
                      <Input
                        aria-label="To address"
                        type="email"
                        placeholder="To"
                        value={emailForm.toAddr}
                        onChange={(e) => setEmailForm((f) => ({ ...f, toAddr: e.target.value }))}
                      />
                    </div>
                    <Input
                      aria-label="Subject"
                      placeholder="Subject"
                      value={emailForm.subject}
                      onChange={(e) => setEmailForm((f) => ({ ...f, subject: e.target.value }))}
                    />
                    <Textarea
                      placeholder="Write the email body…"
                      value={emailForm.body}
                      onChange={(e) => setEmailForm((f) => ({ ...f, body: e.target.value }))}
                    />
                    <div className="flex justify-end">
                      <Button size="sm" onClick={submitEmail} loading={logEmail.isPending} disabled={!emailReady}>
                        <Send className="h-4 w-4" /> Log email
                      </Button>
                    </div>
                  </div>

                  {!customer.emails.length ? (
                    <EmptyState icon={Mail} title="No emails logged" description="Logged emails with this customer will appear here." />
                  ) : (
                    <div className="space-y-3">
                      {customer.emails.map((e) => (
                        <div key={e.id} className="rounded-xl border border-border bg-card/40 p-3">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-sm font-medium text-foreground">{e.subject}</p>
                            <Badge tone={e.direction === 'OUTBOUND' ? 'primary' : 'info'}>
                              <Send className="h-3 w-3" /> {e.direction}
                            </Badge>
                          </div>
                          <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{e.body}</p>
                          <p className="mt-1.5 text-xs text-muted-foreground">
                            {e.fromAddr} → {e.toAddr} · {formatDistanceToNow(new Date(e.sentAt), { addSuffix: true })}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {tab === 'deals' && (
                !customer.deals.length ? (
                  <EmptyState icon={DollarSign} title="No deals" description="This customer has no deals yet." />
                ) : (
                  <div className="space-y-2">
                    {customer.deals.map((d) => (
                      <div key={d.id} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card/40 p-3">
                        <div>
                          <p className="text-sm font-medium text-foreground">{d.title}</p>
                          <p className="text-xs text-muted-foreground">{d.stage?.name} · {d.probability}% probability</p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-semibold text-foreground">{formatCurrency(Number(d.value), d.currency)}</p>
                          <Badge tone={dealStatusTone[d.status]}>{d.status}</Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                )
              )}

              {tab === 'files' && (
                <div className="space-y-4">
                  <input
                    ref={fileInput}
                    type="file"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) uploadFile.mutate(f);
                      e.target.value = '';
                    }}
                  />
                  <Button variant="outline" onClick={() => fileInput.current?.click()} loading={uploadFile.isPending}>
                    <Paperclip className="h-4 w-4" /> Upload file
                  </Button>
                  {!customer.attachments.length ? (
                    <EmptyState icon={Paperclip} title="No files" description="Upload contracts, proposals or other documents." />
                  ) : (
                    <div className="space-y-2">
                      {customer.attachments.map((f) => (
                        <a key={f.id} href={f.url} target="_blank" rel="noreferrer" className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card/40 p-3 hover:bg-muted/40">
                          <div className="flex items-center gap-2.5">
                            <Paperclip className="h-4 w-4 text-muted-foreground" />
                            <div>
                              <p className="text-sm font-medium text-foreground">{f.originalName}</p>
                              <p className="text-xs text-muted-foreground">{(f.size / 1024).toFixed(0)} KB</p>
                            </div>
                          </div>
                          <Download className="h-4 w-4 text-muted-foreground" />
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <CustomerFormModal open={editOpen} onClose={() => setEditOpen(false)} customer={customer} />
    </div>
  );
}

function InfoRow({ icon: Icon, value, href }: { icon: typeof Mail; value: string; href?: string }) {
  // Only allow safe link schemes; stored data could otherwise smuggle javascript: URLs.
  const safeHref = href && /^(https?:|mailto:|tel:)/i.test(href.trim()) ? href : undefined;
  const content = (
    <span className="flex items-center gap-2.5 text-muted-foreground">
      <Icon className="h-4 w-4 shrink-0" />
      <span className="truncate text-foreground">{value}</span>
    </span>
  );
  return safeHref ? <a href={safeHref} target="_blank" rel="noreferrer" className="block hover:underline">{content}</a> : content;
}
