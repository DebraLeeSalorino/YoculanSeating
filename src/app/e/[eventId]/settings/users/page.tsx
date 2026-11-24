import { can, roleIn, ROLE_LABELS, type Role } from "@/domain/permissions";
import { listMembers } from "@/domain/users";
import { requireUser } from "@/lib/session";
import { NoPermission } from "../../no-permission";
import { InviteForm, MemberActions } from "./forms";

export default async function UsersPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const user = await requireUser();
  if (!can(await roleIn(user.id, eventId), "manageUsers")) return <NoPermission />;
  const members = await listMembers({ userId: user.id }, eventId);
  const roles = Object.entries(ROLE_LABELS).map(([value, label]) => ({ value: value as Role, label }));

  return (
    <>
      <h1>Users</h1>
      <InviteForm eventId={eventId} roles={roles} />
      <div className="table-wrap">
        <table className="list">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.userId}>
                <td>
                  {m.name}
                  {!m.hasPassword && <span className="muted"> (invited)</span>}
                </td>
                <td>{m.email}</td>
                <td colSpan={2}>
                  <MemberActions eventId={eventId} userId={m.userId} name={m.name} role={m.role} roles={roles} isSelf={m.userId === user.id} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
