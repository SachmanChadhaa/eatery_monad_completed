import { existsSync, appendFileSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { execSync } from 'node:child_process'

const foundryBin = join(homedir(), '.foundry', 'bin')

// 1. Add to Windows User PATH
if (process.platform === 'win32') {
  try {
    const currentPath = execSync('powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable(\'Path\', \'User\')"', { encoding: 'utf8' }).trim()
    if (!currentPath.toLowerCase().includes('.foundry\\bin')) {
      const newPath = currentPath ? `${currentPath};${foundryBin}` : foundryBin
      execSync(`powershell -NoProfile -Command "[Environment]::SetEnvironmentVariable('Path', '${newPath.replace(/'/g, "''")}', 'User')"`)
      console.log('Added ~/.foundry/bin to Windows User PATH.')
    } else {
      console.log('~/.foundry/bin is already in Windows User PATH.')
    }
  } catch (err) {
    console.warn('Could not update Windows User PATH:', err.message)
  }
}

// 2. Add to ~/.bashrc and ~/.bash_profile for Git Bash / MINGW64
const bashrc = join(homedir(), '.bashrc')
const bashProfile = join(homedir(), '.bash_profile')

const exportLine = 'export PATH="$HOME/.foundry/bin:$PATH"\n'
let bashrcUpdated = false

if (existsSync(bashrc)) {
  const content = readFileSync(bashrc, 'utf8')
  if (!content.includes('.foundry/bin')) {
    appendFileSync(bashrc, `\n${exportLine}`)
    bashrcUpdated = true
  }
} else {
  appendFileSync(bashrc, exportLine)
  bashrcUpdated = true
}

if (bashrcUpdated) {
  console.log('Added ~/.foundry/bin to ~/.bashrc')
}

const sourceBashrc = 'if [ -f ~/.bashrc ]; then . ~/.bashrc; fi\n'
if (existsSync(bashProfile)) {
  const content = readFileSync(bashProfile, 'utf8')
  if (!content.includes('.bashrc')) {
    appendFileSync(bashProfile, `\n${sourceBashrc}`)
  }
} else {
  appendFileSync(bashProfile, sourceBashrc)
}
