import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { expect } from 'chai';
import { utils } from 'ethers';
import { defaultAbiCoder, keccak256 } from 'ethers/lib/utils';
import { waffle } from 'hardhat';
import { IMockMuffinHub, MockCaller, MockERC20 } from '../../typechain';
import { LimitOrderType } from '../shared/constants';
import { hubWithPoolFixture } from '../shared/fixtures';
import { getEvent, wad } from '../shared/utils';

const ACC_REF_ID = 1;
const POS_REF_ID = 777;

describe('hub collect settled positions', () => {
  let hub: IMockMuffinHub;
  let caller: MockCaller;
  let token0: MockERC20;
  let token1: MockERC20;
  let user: SignerWithAddress;
  let poolId: string;

  const tickLower = -1;
  const tickUpper = 1;

  const getAccBalance = async (token: string, owner: string, accRefId: number) => {
    const accHash = keccak256(defaultAbiCoder.encode(['address', 'uint256'], [owner, accRefId]));
    return await hub.accounts(token, accHash);
  };

  beforeEach(async () => {
    ({ hub, caller, token0, token1, user, poolId } = await waffle.loadFixture(hubWithPoolFixture));
    await hub.setTierParameters(poolId, 0, 99850, 2);
    await caller.mint({
      token0: token0.address,
      token1: token1.address,
      tierId: 0,
      tickLower: tickLower,
      tickUpper: tickUpper,
      liquidityD8: 10000,
      recipient: user.address,
      positionRefId: POS_REF_ID,
      senderAccRefId: 0,
      data: [],
    });
    await hub.setLimitOrderType(token0.address, token1.address, 0, tickLower, tickUpper, POS_REF_ID, LimitOrderType.ONE_FOR_ZERO);
    await hub.increaseFeeGrowthGlobal(poolId, wad(1), wad(1));
    await caller.swap(token0.address, token1.address, 0x3f, 300, caller.address, 0, 0, utils.id(''));
    expect(await getAccBalance(token0.address, user.address, ACC_REF_ID)).eq(0);
    expect(await getAccBalance(token1.address, user.address, ACC_REF_ID)).eq(0);
  });

  it('collect successfully', async () => {
    const tx = await hub.collectSettled({
      token0: token0.address,
      token1: token1.address,
      tierId: 0,
      tickLower: tickLower,
      tickUpper: tickUpper,
      liquidityD8: 10000,
      positionRefId: POS_REF_ID,
      accRefId: ACC_REF_ID,
      collectAllFees: false,
    });
    const event = await getEvent(tx, hub, 'CollectSettled');
    expect(event.poolId).eq(poolId);
    expect(event.owner).eq(user.address);
    expect(event.positionRefId).eq(POS_REF_ID);
    expect(event.tierId).eq(0);
    expect(event.tickLower).eq(tickLower);
    expect(event.tickUpper).eq(tickUpper);
    expect(event.liquidityD8).eq(10000);
    expect(event.amount0).gt(0);
    expect(event.amount1).eq(0);
    expect(event.feeAmount0).gt(0);
    expect(event.feeAmount1).gt(0);

    expect(await getAccBalance(token0.address, user.address, ACC_REF_ID)).eq(event.amount0.add(event.feeAmount0));
    expect(await getAccBalance(token1.address, user.address, ACC_REF_ID)).eq(event.amount1.add(event.feeAmount1));
  });
});
