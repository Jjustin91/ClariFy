import type { ClassFaq } from '@/types/api';

interface ClassFaqSidebarProps {
  faqs: ClassFaq[];
}

export function ClassFaqSidebar({ faqs }: ClassFaqSidebarProps) {
  return (
    <aside className="rounded-xl border border-ustp-navy/10 bg-white p-4 shadow-sm">
      <h2 className="text-lg font-bold text-ustp-navy">Class FAQs</h2>
      {faqs.length === 0 ? (
        <p className="mt-3 rounded-lg border border-dashed border-ustp-navy/20 p-4 text-sm text-ustp-text/70">
          No Class FAQs published for this course yet.
        </p>
      ) : (
        <div className="mt-3 space-y-3">
          {faqs.map((faq) => (
            <details key={faq.id} className="group rounded-lg border border-ustp-navy/10 p-3">
              <summary className="cursor-pointer list-none font-semibold text-ustp-text marker:hidden">
                <span className="text-ustp-blue">{faq.subject_hashtag}</span>
                <span className="ml-2 text-xs text-ustp-text/50">1-Click Converted</span>
              </summary>
              <div className="mt-3 space-y-3 text-sm leading-6 text-ustp-text">
                <p>{faq.question}</p>
                <div className="border-l-2 border-ustp-gold pl-3">
                  <p className="text-xs font-bold text-ustp-navy">Faculty Answer</p>
                  <p>{faq.answer}</p>
                </div>
                <p className="text-xs text-ustp-text/60">Anonymous Student</p>
              </div>
            </details>
          ))}
        </div>
      )}
    </aside>
  );
}
