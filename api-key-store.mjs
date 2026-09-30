import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const privateDir = fileURLToPath(new URL('./private/', import.meta.url));
function quotedPath(filename = 'panta-api-key.xml') {
  if (!/^[a-z0-9][a-z0-9_-]*\.xml$/.test(filename)) throw new Error('Invalid credential filename.');
  const keyPath = fileURLToPath(new URL(`./private/${filename}`, import.meta.url));
  return "'" + keyPath.replaceAll("'", "''") + "'";
}

function powershell(command, input = '') {
  return new Promise((resolve, reject) => {
    // PowerShell 7 may pass its module search path to Windows PowerShell 5.1.
    // Load the child's own built-in modules without changing machine settings.
    const builtIns = "Import-Module -Name ($PSHOME + '/Modules/Microsoft.PowerShell.Security/Microsoft.PowerShell.Security.psd1') -ErrorAction Stop; Import-Module -Name ($PSHOME + '/Modules/Microsoft.PowerShell.Utility/Microsoft.PowerShell.Utility.psd1') -ErrorAction Stop; ";
    const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', builtIns + command], {
      windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'],
    });
    let output = '';
    const timeout = setTimeout(() => { child.kill(); reject(new Error('Credential operation timed out.')); }, 12_000);
    child.stdout.on('data', chunk => { output += chunk.toString('utf8'); if (output.length > 2048) child.kill(); });
    child.stdin.on('error', () => {});
    child.on('error', () => { clearTimeout(timeout); reject(new Error('Windows credential protection unavailable.')); });
    child.on('close', code => {
      clearTimeout(timeout);
      if (code !== 0 || output.length > 2048) return reject(new Error('Windows credential operation failed.'));
      resolve(output);
    });
    child.stdin.end(input);
  });
}

export async function persistApiKey(key, { filename } = {}) {
  if (!/^pk_(test|live)_[A-Za-z0-9_-]{8,256}$/.test(key)) throw new Error('Unexpected key format.');
  await mkdir(privateDir, { recursive: true });
  const literalPath = quotedPath(filename);
  await powershell(`$ErrorActionPreference='Stop'; $pantaPlain=[Console]::In.ReadToEnd(); $pantaSecure=ConvertTo-SecureString -String $pantaPlain -AsPlainText -Force; try { [pscustomobject]@{apiKey=$pantaSecure} | Export-Clixml -LiteralPath ${literalPath} } finally { $pantaSecure.Dispose(); $pantaPlain=$null }`, key);
}

export async function loadApiKey({ filename } = {}) {
  const literalPath = quotedPath(filename);
  const key = await powershell(`$ErrorActionPreference='Stop'; $pantaSaved=Import-Clixml -LiteralPath ${literalPath}; $pantaBuffer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($pantaSaved.apiKey); try { [Console]::Out.Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($pantaBuffer)) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pantaBuffer); $pantaSaved.apiKey.Dispose() }`);
  if (!/^pk_(test|live)_[A-Za-z0-9_-]{8,256}$/.test(key)) throw new Error('Saved credential unavailable.');
  return key;
}
