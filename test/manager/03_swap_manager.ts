import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { expect } from 'chai';
import { constants } from 'ethers';
import { defaultAbiCoder, keccak256, solidityPack } from 'ethers/lib/utils';
import { waffle } from 'hardhat';
import { Manager, IMockMuffinHub, MockERC20, WETH9 } from '../../typechain';
import { managerFixture } from '../shared/fixtures';
import { bn, expectBalanceChanges, getEvent, getEvents } from '../shared/utils';

const { MaxUint256 } = constants;

describe('manager swap manager', () => {
  let hub: IMockMuffinHub;
  let manager: Manager;
  let token0: MockERC20;
  let token1: MockERC20;
  let token2: MockERC20;
  let poolId01: string;
  let poolId12: string;
  let poolId2E: string;
  let weth: WETH9;
  let user: SignerWithAddress;
  let other: SignerWithAddress;

  beforeEach(async () => {
    ({ hub, manager, token0, token1, token2, weth, poolId01, poolId12, poolId2E, user, other } = await waffle.loadFixture(
      managerFixture,
    ));
  });

  const getAccBalance = async (token: string, userAddress: string) => {
    const accHash = keccak256(defaultAbiCoder.encode(['address', 'uint256'], [manager.address, bn(userAddress)]));
    return await hub.accounts(token, accHash);
  };

  const toPath = (tokens: (MockERC20 | WETH9)[]) => {
    const types = [];
    const values = [];
    for (const token of tokens) {
      types.push('address');
      types.push('uint8');
      values.push(token.address);
      values.push(0b111111);
    }
    types.pop();
    values.pop();
    return solidityPack(types, values);
  };

  context('exactInSingle', () => {
    it('too little received', async () => {
      await expect(
        manager.exactInSingle(token0.address, token1.address, 0x3f, 3, 2, user.address, false, false),
      ).to.be.revertedWith('TOO_LITTLE_RECEIVED');
    });

    it('0 -> 1', async () => {
      await expectBalanceChanges(
        [
          { account: user, token: token0, delta: -3 },
          { account: user, token: token1, delta: 1 },
          { account: hub, token: token0, delta: 3 },
          { account: hub, token: token1, delta: -1 },
        ],
        async () => {
          const tx = await manager.exactInSingle(token0.address, token1.address, 0x3f, 3, 0, user.address, false, false);
          const event = await getEvent(tx, hub, 'Swap');
          expect(event.poolId).eq(poolId01);
          expect(event.amount0).eq(3);
          expect(event.amount1).eq(-1);
        },
      );
    });

    it('eth -> 2', async () => {
      await expectBalanceChanges(
        [
          { account: user, token: 'ETH', delta: -3 },
          { account: user, token: weth, delta: 0 },
          { account: user, token: token2, delta: 1 },
          { account: hub, token: weth, delta: 3 },
          { account: hub, token: token2, delta: -1 },
        ],
        async () => {
          const data = [
            manager.interface.encodeFunctionData('exactInSingle', [weth.address, token2.address, 0x3f, 3, 0, user.address, false, false]), // prettier-ignore
            manager.interface.encodeFunctionData('refundETH'),
          ];
          const tx = await manager.multicall(data, { value: 99999 });
          const event = await getEvent(tx, hub, 'Swap');
          expect(event.poolId).eq(poolId2E);
          expect(event.amount0).eq(-1);
          expect(event.amount1).eq(3);
        },
      );
    });

    it('2 -> eth', async () => {
      await expectBalanceChanges(
        [
          { account: user, token: token2, delta: -3 },
          { account: user, token: weth, delta: 0 },
          { account: user, token: 'ETH', delta: 1 },
          { account: hub, token: token2, delta: 3 },
          { account: hub, token: weth, delta: -1 },
        ],
        async () => {
          const data = [
            manager.interface.encodeFunctionData('exactInSingle', [token2.address, weth.address, 0x3f, 3, 0, manager.address, false, false]), // prettier-ignore
            manager.interface.encodeFunctionData('unwrapWETH', [1, user.address]),
          ];
          const tx = await manager.multicall(data);
          const event = await getEvent(tx, hub, 'Swap');
          expect(event.poolId).eq(poolId2E);
          expect(event.amount0).eq(3);
          expect(event.amount1).eq(-1);
        },
      );
    });

    it('use internal account', async () => {
      await hub.addAccountBalance(manager.address, bn(user.address), token0.address, 100);
      await expectBalanceChanges(
        [
          { account: user, token: token0, delta: 0 },
          { account: user, token: token1, delta: 0 },
          { account: hub, token: token0, delta: 0 },
          { account: hub, token: token1, delta: 0 },
        ],
        async () => {
          const accBalance0Before = await getAccBalance(token0.address, user.address);
          const accBalance1Before = await getAccBalance(token1.address, user.address);

          const tx = await manager.exactInSingle(token0.address, token1.address, 0x3f, 3, 0, user.address, true, true);
          const event = await getEvent(tx, hub, 'Swap');
          expect(event.poolId).eq(poolId01);
          expect(event.amount0).eq(3);
          expect(event.amount1).eq(-1);

          expect((await getAccBalance(token0.address, user.address)).sub(accBalance0Before)).eq(-3);
          expect((await getAccBalance(token1.address, user.address)).sub(accBalance1Before)).eq(+1);
        },
      );
    });
  });

  context('exactIn', () => {
    it('too little received', async () => {
      await expect(manager.exactIn(toPath([token0, token1]), 3, 2, user.address, false, false)).to.be.revertedWith(
        'TOO_LITTLE_RECEIVED',
      );
    });

    it('0 -> 1', async () => {
      await expectBalanceChanges(
        [
          { account: user, token: token0, delta: -3 },
          { account: user, token: token1, delta: 1 },
          { account: hub, token: token0, delta: 3 },
          { account: hub, token: token1, delta: -1 },
        ],
        async () => {
          const tx = await manager.exactIn(toPath([token0, token1]), 3, 0, user.address, false, false);
          const event = await getEvent(tx, hub, 'Swap');
          expect(event.poolId).eq(poolId01);
          expect(event.amount0).eq(3);
          expect(event.amount1).eq(-1);
        },
      );
    });

    it('0 -> 1 -> 2', async () => {
      await expectBalanceChanges(
        [
          { account: user, token: token0, delta: -5 },
          { account: user, token: token2, delta: 1 },
          { account: hub, token: token0, delta: 5 },
          { account: hub, token: token2, delta: -1 },
        ],
        async () => {
          const tx = await manager.exactIn(toPath([token0, token1, token2]), 5, 0, user.address, false, false);
          const events = await getEvents(tx, hub, 'Swap');
          expect(events[0].poolId).eq(poolId01);
          expect(events[0].amount0).eq(5);
          expect(events[0].amount1).eq(-3);

          expect(events[1].poolId).eq(poolId12);
          expect(events[1].amount0).eq(3);
          expect(events[1].amount1).eq(-1);
        },
      );
    });

    it('eth -> 2 -> 1', async () => {
      await expectBalanceChanges(
        [
          { account: user, token: 'ETH', delta: -5 },
          { account: user, token: weth, delta: 0 },
          { account: user, token: token1, delta: 1 },
          { account: hub, token: weth, delta: 5 },
          { account: hub, token: token1, delta: -1 },
        ],
        async () => {
          const data = [
            manager.interface.encodeFunctionData('exactIn', [toPath([weth, token2, token1]), 5, 0, user.address, false, false]),
            manager.interface.encodeFunctionData('refundETH'),
          ];
          const tx = await manager.multicall(data, { value: 99999 });
          const events = await getEvents(tx, hub, 'Swap');
          expect(events[0].poolId).eq(poolId2E);
          expect(events[0].amount0).eq(-3);
          expect(events[0].amount1).eq(5);

          expect(events[1].poolId).eq(poolId12);
          expect(events[1].amount0).eq(-1);
          expect(events[1].amount1).eq(3);
        },
      );
    });

    it('1 -> 2 -> eth', async () => {
      await expectBalanceChanges(
        [
          { account: user, token: token1, delta: -5 },
          { account: user, token: weth, delta: 0 },
          { account: user, token: 'ETH', delta: 1 },
          { account: hub, token: token1, delta: 5 },
          { account: hub, token: weth, delta: -1 },
        ],
        async () => {
          const data = [
            manager.interface.encodeFunctionData('exactIn', [toPath([token1, token2, weth]), 5, 0, manager.address, false, false]), // prettier-ignore
            manager.interface.encodeFunctionData('unwrapWETH', [1, user.address]),
          ];
          const tx = await manager.multicall(data);
          const events = await getEvents(tx, hub, 'Swap');
          expect(events[0].poolId).eq(poolId12);
          expect(events[0].amount0).eq(5);
          expect(events[0].amount1).eq(-3);

          expect(events[1].poolId).eq(poolId2E);
          expect(events[1].amount0).eq(3);
          expect(events[1].amount1).eq(-1);
        },
      );
    });

    it('use internal account', async () => {
      await hub.addAccountBalance(manager.address, bn(user.address), token0.address, 100);
      await expectBalanceChanges(
        [
          { account: user, token: token0, delta: 0 },
          { account: user, token: token2, delta: 0 },
          { account: hub, token: token0, delta: 0 },
          { account: hub, token: token2, delta: 0 },
        ],
        async () => {
          const accBalance0Before = await getAccBalance(token0.address, user.address);
          const accBalance1Before = await getAccBalance(token1.address, user.address);
          await manager.exactIn(toPath([token0, token1]), 3, 0, user.address, true, true);
          expect((await getAccBalance(token0.address, user.address)).sub(accBalance0Before)).eq(-3);
          expect((await getAccBalance(token1.address, user.address)).sub(accBalance1Before)).eq(+1);
        },
      );
    });
  });

  context('exactOutSingle', () => {
    it('too much requested', async () => {
      await expect(
        manager.exactOutSingle(token0.address, token1.address, 0x3f, 1, 2, user.address, false, false),
      ).to.be.revertedWith('TOO_MUCH_REQUESTED');
    });

    it('1 <- 0', async () => {
      await expectBalanceChanges(
        [
          { account: user, token: token0, delta: -3 },
          { account: user, token: token1, delta: 1 },
          { account: hub, token: token0, delta: 3 },
          { account: hub, token: token1, delta: -1 },
        ],
        async () => {
          const tx = await manager.exactOutSingle(token0.address, token1.address, 0x3f, 1, MaxUint256, user.address, false, false); // prettier-ignore
          const event = await getEvent(tx, hub, 'Swap');
          expect(event.poolId).eq(poolId01);
          expect(event.amount0).eq(3);
          expect(event.amount1).eq(-1);
        },
      );
    });

    it('2 <- eth', async () => {
      await expectBalanceChanges(
        [
          { account: user, token: 'ETH', delta: -3 },
          { account: user, token: weth, delta: 0 },
          { account: user, token: token2, delta: 1 },
          { account: hub, token: weth, delta: 3 },
          { account: hub, token: token2, delta: -1 },
        ],
        async () => {
          const data = [
            manager.interface.encodeFunctionData('exactOutSingle', [weth.address, token2.address, 0x3f, 1, MaxUint256, user.address, false, false]), // prettier-ignore
            manager.interface.encodeFunctionData('refundETH'),
          ];
          const tx = await manager.multicall(data, { value: 99999 });
          const event = await getEvent(tx, hub, 'Swap');
          expect(event.poolId).eq(poolId2E);
          expect(event.amount0).eq(-1);
          expect(event.amount1).eq(3);
        },
      );
    });

    it('eth <- 2', async () => {
      await expectBalanceChanges(
        [
          { account: user, token: token2, delta: -3 },
          { account: user, token: weth, delta: 0 },
          { account: user, token: 'ETH', delta: 1 },
          { account: hub, token: token2, delta: 3 },
          { account: hub, token: weth, delta: -1 },
        ],
        async () => {
          const data = [
            manager.interface.encodeFunctionData('exactOutSingle', [token2.address, weth.address, 0x3f, 1, MaxUint256, manager.address, false, false]), // prettier-ignore
            manager.interface.encodeFunctionData('unwrapWETH', [1, user.address]),
          ];
          const tx = await manager.multicall(data);
          const event = await getEvent(tx, hub, 'Swap');
          expect(event.poolId).eq(poolId2E);
          expect(event.amount0).eq(3);
          expect(event.amount1).eq(-1);
        },
      );
    });

    it('use internal account', async () => {
      await hub.addAccountBalance(manager.address, bn(user.address), token0.address, 100);
      await expectBalanceChanges(
        [
          { account: user, token: token0, delta: 0 },
          { account: user, token: token1, delta: 0 },
          { account: hub, token: token0, delta: 0 },
          { account: hub, token: token1, delta: 0 },
        ],
        async () => {
          const accBalance0Before = await getAccBalance(token0.address, user.address);
          const accBalance1Before = await getAccBalance(token1.address, user.address);

          const tx = await manager.exactOutSingle(token0.address, token1.address, 0x3f, 1, MaxUint256, user.address, true, true);
          const event = await getEvent(tx, hub, 'Swap');
          expect(event.poolId).eq(poolId01);
          expect(event.amount0).eq(3);
          expect(event.amount1).eq(-1);

          expect((await getAccBalance(token0.address, user.address)).sub(accBalance0Before)).eq(-3);
          expect((await getAccBalance(token1.address, user.address)).sub(accBalance1Before)).eq(+1);
        },
      );
    });
  });

  context('exactOut', () => {
    it('too little received', async () => {
      await expect(manager.exactOut(toPath([token0, token1]), 1, 2, user.address, false, false)).to.be.revertedWith(
        'TOO_MUCH_REQUESTED',
      );
    });

    it('1 <- 0', async () => {
      await expectBalanceChanges(
        [
          { account: user, token: token0, delta: -3 },
          { account: user, token: token1, delta: 1 },
          { account: hub, token: token0, delta: 3 },
          { account: hub, token: token1, delta: -1 },
        ],
        async () => {
          const tx = await manager.exactOut(toPath([token1, token0]), 1, MaxUint256, user.address, false, false);
          const event = await getEvent(tx, hub, 'Swap');
          expect(event.poolId).eq(poolId01);
          expect(event.amount0).eq(3);
          expect(event.amount1).eq(-1);
        },
      );
    });

    it('2 <- 1 <- 0', async () => {
      await expectBalanceChanges(
        [
          { account: user, token: token0, delta: -105 },
          { account: user, token: token2, delta: 1 },
          { account: hub, token: token0, delta: 105 },
          { account: hub, token: token2, delta: -1 },
        ],
        async () => {
          const tx = await manager.exactOut(toPath([token2, token1, token0]), 1, MaxUint256, user.address, false, false);
          const events = await getEvents(tx, hub, 'Swap');
          expect(events[0].poolId).eq(poolId12);
          expect(events[0].amount0).eq(3);
          expect(events[0].amount1).eq(-1);

          expect(events[1].poolId).eq(poolId01);
          expect(events[1].amount0).eq(105);
          expect(events[1].amount1).eq(-103);
        },
      );
    });

    it('1 <- 2 <- eth', async () => {
      await expectBalanceChanges(
        [
          { account: user, token: 'ETH', delta: -105 },
          { account: user, token: weth, delta: 0 },
          { account: user, token: token1, delta: 1 },
          { account: hub, token: weth, delta: 105 },
          { account: hub, token: token1, delta: -1 },
        ],
        async () => {
          const data = [
            manager.interface.encodeFunctionData('exactOut', [toPath([token1, token2, weth]), 1, MaxUint256, user.address, false, false]), // prettier-ignore
            manager.interface.encodeFunctionData('refundETH'),
          ];
          const tx = await manager.multicall(data, { value: 99999 });
          const events = await getEvents(tx, hub, 'Swap');
          expect(events[0].poolId).eq(poolId12);
          expect(events[0].amount0).eq(-1);
          expect(events[0].amount1).eq(3);

          expect(events[1].poolId).eq(poolId2E);
          expect(events[1].amount0).eq(-103);
          expect(events[1].amount1).eq(105);
        },
      );
    });

    it('eth <- 2 <- 1', async () => {
      await expectBalanceChanges(
        [
          { account: user, token: token1, delta: -105 },
          { account: user, token: weth, delta: 0 },
          { account: user, token: 'ETH', delta: 1 },
          { account: hub, token: token1, delta: 105 },
          { account: hub, token: weth, delta: -1 },
        ],
        async () => {
          const data = [
            manager.interface.encodeFunctionData('exactOut', [toPath([weth, token2, token1]), 1, MaxUint256, manager.address, false, false]), // prettier-ignore
            manager.interface.encodeFunctionData('unwrapWETH', [1, user.address]),
          ];
          const tx = await manager.multicall(data);
          const events = await getEvents(tx, hub, 'Swap');
          expect(events[0].poolId).eq(poolId2E);
          expect(events[0].amount0).eq(3);
          expect(events[0].amount1).eq(-1);

          expect(events[1].poolId).eq(poolId12);
          expect(events[1].amount0).eq(105);
          expect(events[1].amount1).eq(-103);
        },
      );
    });

    it('use internal account', async () => {
      await hub.addAccountBalance(manager.address, bn(user.address), token0.address, 100);
      await expectBalanceChanges(
        [
          { account: user, token: token0, delta: 0 },
          { account: user, token: token1, delta: 0 },
          { account: hub, token: token0, delta: 0 },
          { account: hub, token: token1, delta: 0 },
        ],
        async () => {
          const accBalance0Before = await getAccBalance(token0.address, user.address);
          const accBalance1Before = await getAccBalance(token1.address, user.address);

          const tx = await manager.exactOut(toPath([token1, token0]), 1, MaxUint256, user.address, true, true);
          const event = await getEvent(tx, hub, 'Swap');
          expect(event.poolId).eq(poolId01);
          expect(event.amount0).eq(3);
          expect(event.amount1).eq(-1);

          expect((await getAccBalance(token0.address, user.address)).sub(accBalance0Before)).eq(-3);
          expect((await getAccBalance(token1.address, user.address)).sub(accBalance1Before)).eq(+1);
        },
      );
    });
  });
});
