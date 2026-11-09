import { Link } from '@tanstack/react-router'
import { BookOpen, LifeBuoy, Mail } from 'lucide-react'
import { Card, CardHeader, IconTile } from '../components/ui'
import { usePublicSettings } from '../lib/settings'

const faq = [
  [
    'How do I connect with SFTP?',
    'Open your server, go to Settings and use the SFTP details shown there with your panel password or an SSH key from Security.',
  ],
  [
    'My server does not start',
    'Check the console for errors. A message about the Java version means you can pick another Java image in Startup. Make sure the server has enough memory.',
  ],
  [
    'How are renewals paid?',
    'An invoice is created a few days before the due date. If your credit balance covers it, it is paid automatically on the due date.',
  ],
  [
    'Can I give a friend access?',
    'Yes. Open the server, go to Users and add them by the email of their account. You choose exactly what they can do.',
  ],
  [
    'How do I restore a backup?',
    'Open the server, go to Backups and use the restore button. The server stops while the files are restored.',
  ],
] as const

export function HelpPage() {
  const settings = usePublicSettings()
  const email = settings.data?.['app.support_email']
  return (
    <>
      <div className="grid gap-4 md:grid-cols-3">
        {settings.data?.['tickets.enabled'] && (
          <Link
            to="/tickets/new"
            className="flex items-center gap-4 rounded-card border border-line bg-surface p-5 hover:border-subtle"
          >
            <IconTile>
              <LifeBuoy className="size-5" />
            </IconTile>
            <div>
              <p className="font-medium">Open a ticket</p>
              <p className="text-[13px] text-muted">Our team replies here and by email.</p>
            </div>
          </Link>
        )}
        {email && (
          <div className="flex items-center gap-4 rounded-card border border-line bg-surface p-5">
            <IconTile>
              <Mail className="size-5" />
            </IconTile>
            <div className="min-w-0">
              <p className="font-medium">Email us</p>
              <p className="truncate text-[13px] text-muted">{email}</p>
            </div>
          </div>
        )}
        <a
          href="https://ammonode.github.io/docs/"
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-4 rounded-card border border-line bg-surface p-5 hover:border-subtle"
        >
          <IconTile>
            <BookOpen className="size-5" />
          </IconTile>
          <div>
            <p className="font-medium">Documentation</p>
            <p className="text-[13px] text-muted">Guides for servers, files and billing.</p>
          </div>
        </a>
      </div>
      <Card>
        <CardHeader title="Common questions" />
        <div className="divide-y divide-line border-t border-line">
          {faq.map(([q, a]) => (
            <details key={q} className="group px-5 py-3">
              <summary className="cursor-pointer list-none text-[13.5px] font-medium marker:hidden">
                {q}
              </summary>
              <p className="mt-2 text-[13px] text-muted">{a}</p>
            </details>
          ))}
        </div>
      </Card>
    </>
  )
}
