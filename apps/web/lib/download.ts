/** Fetch an API path with the access token and hand the response to the browser as a file. Returns false if the server said no. */
export async function downloadApi(accessToken: string, path: string, filename: string): Promise<boolean> {
  const res = await fetch(`/api/v1/${path}`, { headers: { authorization: `Bearer ${accessToken}` } });
  if (!res.ok) return false;
  const url = URL.createObjectURL(await res.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
  return true;
}
