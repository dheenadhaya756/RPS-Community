import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { loadPublicWorkshops } from '@/lib/community/publicWorkshops';
import WorkshopClient from './WorkshopClient';

function initialsFrom(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'U';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// SERVER component: reads the session and passes only minimal identity fields to
// the client shell. Middleware already guards /workshop; this is a fallback.
export default async function WorkshopPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/signin?next=/workshop');

  const { data: profile } = await supabase
    .from('profiles')
    .select('name, avatar_url')
    .eq('id', user.id)
    .single();

  const name = profile?.name || user.user_metadata?.name || 'Your profile';

  const { workshops, error } = await loadPublicWorkshops();

  return (
    <WorkshopClient
      name={name}
      email={user.email || ''}
      avatarUrl={profile?.avatar_url || ''}
      initials={initialsFrom(name)}
      workshops={workshops}
      loadError={error}
    />
  );
}
