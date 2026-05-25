'use client';
import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
export default function TailorRedirect() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  useEffect(() => { router.replace(`/minds/${id}/settings`); }, [id, router]);
  return null;
}
