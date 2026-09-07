import { HOW_IT_WORKS } from '@/content/home';
import { Section, SectionHeader } from './section';
import { Reveal } from './reveal';

export function HowItWorks() {
  return (
    <Section id="how-it-works" tone="canvas">
      <SectionHeader
        eyebrow={HOW_IT_WORKS.eyebrow}
        heading={HOW_IT_WORKS.heading}
        description={HOW_IT_WORKS.description}
      />

      <ol className="relative mt-14 grid gap-10 sm:gap-12 lg:grid-cols-3 lg:gap-10">
        {/*
          The rule threading the three steps together. Sits behind the numbered
          badges and only exists on the desktop layout, where the steps run
          horizontally — stacked on mobile there is nothing to connect.
        */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute top-6 right-0 left-0 hidden h-px bg-hairline lg:block"
        />

        {HOW_IT_WORKS.steps.map((step, index) => (
          <Reveal as="li" key={step.number} delay={index * 90} className="relative">
            <span className="inline-flex size-12 items-center justify-center rounded-full border border-hairline bg-surface text-[0.875rem] font-semibold tabular-nums text-brand-700">
              {step.number}
            </span>
            <h3 className="mt-5 text-[1.125rem] font-semibold tracking-[-0.015em] text-foreground">
              {step.title}
            </h3>
            <p className="mt-2.5 text-[0.9375rem] leading-relaxed text-pretty text-muted-foreground">
              {step.body}
            </p>
          </Reveal>
        ))}
      </ol>
    </Section>
  );
}
