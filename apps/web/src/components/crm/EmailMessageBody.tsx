import { readableEmail } from '../../lib/email-text';
import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export default function EmailMessageBody({ body }: { body: string }): JSX.Element {
  const message = readableEmail(body);
  return <div className="space-y-3 text-sm leading-7 text-slate-700 [overflow-wrap:anywhere]">
    <ReactMarkdown skipHtml remarkPlugins={[remarkGfm]} components={{
      p: ({ children }) => <p className="mb-3 whitespace-pre-line last:mb-0">{children}</p>,
      strong: ({ children }) => <strong className="font-semibold text-slate-900">{children}</strong>,
      h1: ({ children }) => <h5 className="mb-2 mt-4 text-base font-semibold text-slate-900">{children}</h5>,
      h2: ({ children }) => <h5 className="mb-2 mt-4 font-semibold text-slate-900">{children}</h5>,
      h3: ({ children }) => <h5 className="mb-2 mt-4 font-semibold text-slate-900">{children}</h5>,
      ul: ({ children }) => <ul className="mb-3 list-disc space-y-1 pl-5">{children}</ul>,
      ol: ({ children }) => <ol className="mb-3 list-decimal space-y-1 pl-5">{children}</ol>,
      a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer" className="font-medium text-sky-700 underline decoration-sky-300 underline-offset-2">{children}</a>,
      img: () => null,
      blockquote: ({ children }) => <blockquote className="my-3 border-l-2 border-slate-300 pl-3 text-slate-600">{children}</blockquote>,
      pre: ({ children }) => <pre className="my-3 overflow-x-auto rounded bg-slate-100 p-3 text-xs">{children}</pre>,
      table: ({ children }) => <div className="my-3 overflow-x-auto"><table className="w-full border-collapse text-left text-xs">{children}</table></div>,
      th: ({ children }) => <th className="border border-slate-200 bg-slate-100 px-3 py-2 font-semibold">{children}</th>,
      td: ({ children }) => <td className="border border-slate-200 px-3 py-2">{children}</td>,
    }}>{message.text}</ReactMarkdown>
    {message.quoted ? <details className="border-t border-current/10 pt-2">
      <summary className="cursor-pointer text-xs font-medium opacity-70">Show quoted email</summary>
      <div className="mt-2 whitespace-pre-wrap border-l-2 border-current/20 pl-3 text-xs leading-6 opacity-80">{message.quoted}</div>
    </details> : null}
  </div>;
}
