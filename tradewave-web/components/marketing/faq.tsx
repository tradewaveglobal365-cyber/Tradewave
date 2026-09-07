import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { FAQ } from '@/content/home';
import { Section, SectionHeader } from './section';
import { Reveal } from './reveal';

/**
 * The accordion itself is a client component; this section stays on the server.
 *
 * Two answers are flagged `placeholder` in content/home.ts — both are written so
 * they are not false as they stand, but they need real detail from the client.
 * The marker below only renders in development.
 */
export function Faq() {
  const isDev = process.env.NODE_ENV === 'development';

  return (
    <Section id="faq" tone="surface">
      <div className="grid gap-10 lg:grid-cols-[0.8fr_1fr] lg:gap-16">
        <SectionHeader eyebrow={FAQ.eyebrow} heading={FAQ.heading} />

        <Reveal delay={80}>
          <Accordion type="single" collapsible className="w-full">
            {FAQ.items.map((item) => (
              <AccordionItem key={item.q} value={item.q} className="border-hairline">
                <AccordionTrigger className="gap-6 py-5 text-[1rem] font-medium text-foreground hover:no-underline">
                  <span className="text-pretty">
                    {item.q}
                    {isDev && 'placeholder' in item && item.placeholder ? (
                      <span className="ml-2 rounded bg-pending/15 px-1.5 py-0.5 align-middle text-[0.625rem] font-semibold text-pending">
                        TODO
                      </span>
                    ) : null}
                  </span>
                </AccordionTrigger>
                <AccordionContent className="pr-8 pb-5 text-[0.9375rem] leading-relaxed text-pretty text-muted-foreground">
                  {item.a}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </Reveal>
      </div>
    </Section>
  );
}
