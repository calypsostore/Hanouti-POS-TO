import type { ProfileAvatarId } from '../types/domain';

export const DEFAULT_PROFILE_AVATAR_ID: ProfileAvatarId = 'avatar-1';

export const PROFILE_AVATARS: { id: ProfileAvatarId; label: string; background: string; skin: string; hair: string; shirt: string; hairstyle: 'short' | 'bun' | 'side' | 'bob' | 'wrap' | 'waves' }[] = [
  { id: 'avatar-1', label: 'Sage', background: '#d8f0e2', skin: '#bd7858', hair: '#30231f', shirt: '#2c806c', hairstyle: 'short' },
  { id: 'avatar-2', label: 'Sunrise', background: '#ffe6c4', skin: '#e5aa7c', hair: '#583826', shirt: '#db7851', hairstyle: 'bun' },
  { id: 'avatar-3', label: 'Ocean', background: '#d9eafb', skin: '#f0c39b', hair: '#302c39', shirt: '#4d79b8', hairstyle: 'side' },
  { id: 'avatar-4', label: 'Berry', background: '#f2dced', skin: '#89553e', hair: '#1e1b25', shirt: '#a94f86', hairstyle: 'bob' },
  { id: 'avatar-5', label: 'Mint', background: '#d8eeee', skin: '#d59168', hair: '#5d3c28', shirt: '#367a96', hairstyle: 'wrap' },
  { id: 'avatar-6', label: 'Dusk', background: '#e8e0f6', skin: '#f0c6a5', hair: '#75412d', shirt: '#7862a8', hairstyle: 'waves' },
];

export function isProfileAvatarId(value: unknown): value is ProfileAvatarId {
  return typeof value === 'string' && PROFILE_AVATARS.some((avatar) => avatar.id === value);
}
