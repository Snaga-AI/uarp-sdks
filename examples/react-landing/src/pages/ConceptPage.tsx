/** `/docs/concepts/:slug` — one of the ten conceptual sections. */
import { useParams } from 'react-router-dom';
import { Section } from '../docs/Section';
import { CONCEPTS } from '../content/concepts';
import { NotFound } from './NotFound';

export function ConceptPage() {
  const { slug } = useParams();
  const concept = slug ? CONCEPTS[slug] : undefined;
  if (!concept) return <NotFound />;

  const Body = concept.Body;
  return (
    <Section id={concept.slug} title={concept.title}>
      <Body />
    </Section>
  );
}