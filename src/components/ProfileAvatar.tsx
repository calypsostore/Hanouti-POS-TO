import { DEFAULT_PROFILE_AVATAR_ID, PROFILE_AVATARS } from '../data/profileAvatars';
import type { ProfileAvatarId } from '../types/domain';

export function ProfileAvatar({ avatarId = DEFAULT_PROFILE_AVATAR_ID, className = '' }: { avatarId?: ProfileAvatarId; className?: string }) {
  const avatar = PROFILE_AVATARS.find((item) => item.id === avatarId) ?? PROFILE_AVATARS[0];
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" className={className}>
      <circle cx="24" cy="24" r="24" fill={avatar.background} />
      <path d="M5 48c1-10 8-16 19-16s18 6 19 16" fill={avatar.shirt} />
      <path d="M19 29h10v9H19z" fill={avatar.skin} />
      {avatar.hairstyle === 'bun' && <circle cx="24" cy="7" r="6" fill={avatar.hair} />}
      {avatar.hairstyle === 'wrap' ? (
        <path d="M10 23C8 11 14 4 24 4s16 7 14 19l-3 15H13z" fill={avatar.hair} />
      ) : (
        <path
          d={avatar.hairstyle === 'short'
            ? 'M11 23C9 10 15 4 24 4s15 6 13 19l-3 7H14z'
            : avatar.hairstyle === 'bob'
              ? 'M10 23C8 9 15 3 24 3s16 6 14 20v17h-7V23H17v17h-7z'
              : avatar.hairstyle === 'waves'
                ? 'M10 23C8 10 15 4 24 4s16 7 14 20l-4 17h-5V23H18v18h-5z'
                : 'M11 23C9 10 15 4 24 4s15 6 13 19l-3 8H14z'}
          fill={avatar.hair}
        />
      )}
      <ellipse cx="24" cy="22" rx="11" ry="13" fill={avatar.skin} />
      {avatar.hairstyle === 'bun' && <path d="M13 16c3-10 18-11 23-2-5 0-8-2-11-5-3 4-7 6-12 7z" fill={avatar.hair} />}
      {avatar.hairstyle === 'side' && <path d="M13 17c0-9 5-13 12-13 6 0 10 4 11 10-5 1-9-1-12-5-2 4-6 7-11 8z" fill={avatar.hair} />}
      {avatar.hairstyle === 'short' && <path d="M13 17c1-9 5-13 12-13 6 0 10 4 11 10-4-1-7-3-9-6-4 5-8 8-14 9z" fill={avatar.hair} />}
      {avatar.hairstyle === 'bob' && <path d="M12 17c1-9 5-13 12-13 6 0 10 4 11 11-4 1-8-1-11-5-3 4-7 6-12 7z" fill={avatar.hair} />}
      {avatar.hairstyle === 'wrap' && <path d="M11 19C12 8 17 4 24 4s12 4 13 15c-5-5-9-7-13-7s-8 2-13 7z" fill={avatar.background} />}
      {avatar.hairstyle === 'waves' && <path d="M13 17c1-9 5-13 12-13 6 0 10 4 11 11-3 0-5-1-7-3 0 3-2 5-5 6-3-2-7-2-11-1z" fill={avatar.hair} />}
      <circle cx="20" cy="22" r="1" fill="#30231f" />
      <circle cx="28" cy="22" r="1" fill="#30231f" />
      <path d="M21 28c2 2 4 2 6 0" fill="none" stroke="#8e4d48" strokeLinecap="round" strokeWidth="1.5" />
    </svg>
  );
}
