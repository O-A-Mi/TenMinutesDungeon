import type { WeaponId } from '@tmd/shared';
export interface HudSnapshot {
	health: number;
	maxHealth: number;
	remainingMs: number;
	phase: 'active' | 'collapse' | 'complete';
	roomName: string;
	roomIndex: number;
	roomTotal: number;
	objective: string;
	weaponId: WeaponId;
	cooldown: number;
	enemies: number;
	boss?: { name: string; health: number; maxHealth: number; cinematic: boolean };
}
export interface GameResult {
	outcome: 'guardian' | 'death' | 'collapse' | 'escaped';
	elapsedMs: number;
	roomsCleared: number;
	enemiesDefeated: number;
}
export interface GameCallbacks {
	onHud: (hud: HudSnapshot) => void;
	onPause: () => void;
	onReward: () => void;
	onPvp: () => void;
	onResult: (result: GameResult) => void;
	onRoomTransition?: (swap: () => void) => Promise<void>;
	onInventory?: () => void;
	onUsePotion?: () => boolean;
}
