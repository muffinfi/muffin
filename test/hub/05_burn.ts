import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { expect } from 'chai';
import { defaultAbiCoder, keccak256 } from 'ethers/lib/utils';
import { waffle } from 'hardhat';
import { MockCaller, IMockMuffinHub, MockERC20 } from '../../typechain';
import { MAX_TICK, MIN_TICK } from '../shared/constants';
import { hubWithPoolFixture } from '../shared/fixtures';
import { bn, wad } from '../shared/utils';

const POSITION_REF_ID = 123;
const ACC_REF_ID = 1;

describe('hub burn', () => {
  let hub: IMockMuffinHub;
  let caller: MockCaller;
  let token0: MockERC20;
  let token1: MockERC20;
  let user: SignerWithAddress;
  let poolId: string;

  const getAccBalance = async (token: string, owner: string, accRefId: number) => {
    const accHash = keccak256(defaultAbiCoder.encode(['address', 'uint256'], [owner, accRefId]));
    return await hub.accounts(token, accHash);
  };

  const mint = async (params?: Partial<Parameters<MockCaller['functions']['mint']>[0]>) => {
    return await caller.mint({
      token0: token0.address,
      token1: token1.address,
      tierId: 0,
      tickLower: MIN_TICK,
      tickUpper: MAX_TICK,
      liquidityD8: 100,
      recipient: user.address,
      positionRefId: POSITION_REF_ID,
      senderAccRefId: 0,
      data: [],
      ...params,
    });
  };

  const burn = async (params?: Partial<Parameters<MockCaller['functions']['burn']>[0]>) => {
    // note that hub.burn is called by "user"
    return await hub.burn({
      token0: token0.address,
      token1: token1.address,
      tierId: 0,
      tickLower: MIN_TICK,
      tickUpper: MAX_TICK,
      liquidityD8: 50,
      positionRefId: POSITION_REF_ID,
      accRefId: ACC_REF_ID,
      collectAllFees: false,
      ...params,
    });
  };

  beforeEach(async () => {
    ({ hub, caller, token0, token1, user, poolId } = await waffle.loadFixture(hubWithPoolFixture));
    await mint();
    await hub.increaseFeeGrowthGlobal(poolId, wad(1), wad(1));
    expect(await getAccBalance(token0.address, user.address, ACC_REF_ID)).eq(0);
    expect(await getAccBalance(token1.address, user.address, ACC_REF_ID)).eq(0);
  });

  it('invalid token order', async () => {
    await expect(burn({ token0: token1.address, token1: token0.address })).to.be.revertedWith('');
  });

  it('liquidityD8 > type(int96).max', async () => {
    await expect(burn({ liquidityD8: bn(1).shl(96).sub(1) })).to.be.revertedWith('');
  });

  it('burn successfully', async () => {
    await expect(burn({ liquidityD8: 50, collectAllFees: false }))
      .to.emit(hub, 'Burn')
      .withArgs(poolId, user.address, POSITION_REF_ID, ACC_REF_ID, 0, MIN_TICK, MAX_TICK, 50, 12799, 12799, 693, 693);
    expect(await getAccBalance(token0.address, user.address, ACC_REF_ID)).eq(12799 + 693);
    expect(await getAccBalance(token1.address, user.address, ACC_REF_ID)).eq(12799 + 693);
  });
});
