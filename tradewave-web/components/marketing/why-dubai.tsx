import Image from 'next/image';
import { WHY_DUBAI } from '@/content/home';
import { Section, SectionHeader } from './section';
import { Reveal } from './reveal';

export function WhyDubai() {
  return (
    <Section id="why-dubai" tone="canvas">
      <div className="grid gap-12 lg:grid-cols-[0.85fr_1fr] lg:items-center lg:gap-16">
        <Reveal className="relative aspect-[4/5] overflow-hidden rounded-2xl bg-muted lg:order-2">
          <Image
            src={WHY_DUBAI.image.src}
            alt={WHY_DUBAI.image.alt}
            fill
            sizes="(min-width: 1024px) 40vw, 100vw"
            className="object-cover"
          />
        </Reveal>

        <div className="lg:order-1">
          <SectionHeader
            eyebrow={WHY_DUBAI.eyebrow}
            heading={WHY_DUBAI.heading}
            description={WHY_DUBAI.description}
          />

          <dl className="mt-10 grid gap-x-8 gap-y-8 sm:grid-cols-2">
            {WHY_DUBAI.points.map((point, index) => (
              <Reveal key={point.title} delay={index * 70}>
                <dt className="text-[0.9375rem] font-semibold text-foreground">
                  {point.title}
                </dt>
                <dd className="mt-2 text-[0.9375rem] leading-relaxed text-muted-foreground">
                  {point.body}
                </dd>
              </Reveal>
            ))}
          </dl>
        </div>
      </div>
    </Section>
  );
}
