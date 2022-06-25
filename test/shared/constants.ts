import { BigNumber } from 'ethers';

export const MIN_TICK_SPACING = 1;
export const MIN_TICK = -776363;
export const MAX_TICK = 776363;
export const MIN_SQRT_P = BigNumber.from('65539');
export const MAX_SQRT_P = BigNumber.from('340271175397327323250730767849398346765');
export const BASE_LIQUIDITY_D8 = BigNumber.from('100');
export const BASE_LIQUIDITY = BASE_LIQUIDITY_D8.shl(8);

export const MAX_TIERS = 6;
export const MAX_TIER_CHOICES = (1 << MAX_TIERS) - 1;

export const LimitOrderType = {
  NOT_LIMIT_ORDER: 0,
  ZERO_FOR_ONE: 1,
  ONE_FOR_ZERO: 2,
};
