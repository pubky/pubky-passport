import type { InternalClient } from "../client/InternalClient.js";

interface Member {
  readonly isConnected: boolean;
}
interface Group {
  /** The client configuration every member must have. */
  readonly key: string;
  readonly client: InternalClient;
  /** In joining order: the first one still on the page announces a Session. */
  readonly members: Set<Member>;
}

/**
 * `sync-group`: elements on one page with the same group name and the same client configuration
 * share one client, so a sign-in, its cancel and retry, and the Passport chosen in the settings
 * show in all of them. A member with another configuration is refused, and the group's client is
 * left as it is. The last member to leave disposes it.
 */
export class SyncGroups {
  readonly #groups = new Map<string, Group>();

  /**
   * The group's client for `member`, made with `create` for the first one; `undefined` when the
   * group's members have another configuration. `create` may throw, and then nothing is kept.
   */
  join(name: string, key: string, member: Member, create: () => InternalClient) {
    let group = this.#groups.get(name);
    if (group && group.key !== key) return undefined;
    if (!group) {
      group = { key, client: create(), members: new Set() };
      this.#groups.set(name, group);
    }
    group.members.add(member);
    return group.client;
  }

  leave(name: string, member: Member): void {
    const group = this.#groups.get(name);
    if (!group?.members.delete(member) || group.members.size > 0) return;
    this.#groups.delete(name);
    group.client.dispose();
  }

  /** The member that announces the group's Sessions: the first still on the page, else the first. */
  leader(name: string): Member | undefined {
    const members = [...(this.#groups.get(name)?.members ?? [])];
    return members.find((member) => member.isConnected) ?? members[0];
  }
}

/** One registry per page, shared by every `<pubky-passport>` on it. */
export const syncGroups = new SyncGroups();
