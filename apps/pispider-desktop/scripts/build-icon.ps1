# Derive build/icon.ico (256/128/64/48/32/16, PNG-in-ICO) from build/icon.png.
# Re-runnable: scaling uses System.Drawing; the ICO container is hand-written.
# Usage: pwsh scripts/build-icon.ps1 [-SourcePath <png>] [-OutputPath <ico>]
#        [-ValidateOnly]

[CmdletBinding()]
param(
	[string]$SourcePath,
	[string]$OutputPath,
	[switch]$ValidateOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$desktopDir = Split-Path -Parent $scriptDir

if (-not $SourcePath) { $SourcePath = Join-Path $desktopDir "build\icon.png" }
if (-not $OutputPath) { $OutputPath = Join-Path $desktopDir "build\icon.ico" }

$Sizes = @(256, 128, 64, 48, 32, 16)

function Resize-PngBytes {
	param(
		[System.Drawing.Bitmap]$Source,
		[int]$Size
	)

	$target = New-Object System.Drawing.Bitmap($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
	try {
		$graphics = [System.Drawing.Graphics]::FromImage($target)
		try {
			$graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
			$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
			$graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
			$graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
			$graphics.Clear([System.Drawing.Color]::Transparent)
			$graphics.DrawImage($Source, 0, 0, $Size, $Size)
		}
		finally {
			$graphics.Dispose()
		}

		$stream = New-Object System.IO.MemoryStream
		try {
			$target.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
			return $stream.ToArray()
		}
		finally {
			$stream.Dispose()
		}
	}
	finally {
		$target.Dispose()
	}
}

function Write-Ico {
	param(
		[System.Collections.Generic.List[byte[]]]$Entries,
		[int[]]$EntrySizes,
		[string]$Path
	)

	$entryCount = $Entries.Count
	$headerSize = 6
	$entrySize = 16
	$offset = $headerSize + ($entrySize * $entryCount)

	$ms = New-Object System.IO.MemoryStream
	try {
		$writer = New-Object System.IO.BinaryWriter($ms)
		try {
			$writer.Write([uint16]0)      # reserved
			$writer.Write([uint16]1)      # type: icon
			$writer.Write([uint16]$entryCount)

			for ($i = 0; $i -lt $entryCount; $i += 1) {
				$size = $EntrySizes[$i]
				$bytes = $Entries[$i]
				# ICO dimension byte: 0 encodes 256 px.
				$dimByte = if ($size -ge 256) { 0 } else { [byte]$size }
				$writer.Write([byte]$dimByte)
				$writer.Write([byte]$dimByte)
				$writer.Write([byte]0)    # palette count
				$writer.Write([byte]0)    # reserved
				$writer.Write([uint16]1)   # color planes
				$writer.Write([uint16]32)  # bits per pixel
				$writer.Write([uint32]$bytes.Length)
				$writer.Write([uint32]$offset)
				$offset += $bytes.Length
			}

			foreach ($bytes in $Entries) {
				$writer.Write($bytes)
			}
		}
		finally {
			$writer.Dispose()
		}

		[System.IO.File]::WriteAllBytes($Path, $ms.ToArray())
	}
	finally {
		$ms.Dispose()
	}
}

function Read-Ico {
	param([string]$Path)

	$bytes = [System.IO.File]::ReadAllBytes($Path)
	if ($bytes.Length -lt 6) { throw "ICO too short: $Path" }

	$reader = New-Object System.IO.BinaryReader([System.IO.MemoryStream]::new($bytes))
	try {
		$reserved = $reader.ReadUInt16()
		$type = $reader.ReadUInt16()
		$count = $reader.ReadUInt16()

		if ($reserved -ne 0) { throw "ICO reserved field must be 0, got $reserved" }
		if ($type -ne 1) { throw "ICO type must be 1, got $type" }
		if ($count -ne $Sizes.Count) { throw "ICO entry count $count != expected $($Sizes.Count)" }

		$reported = @()
		for ($i = 0; $i -lt $count; $i += 1) {
			$width = $reader.ReadByte()
			$height = $reader.ReadByte()
			$palette = $reader.ReadByte()
			$reserved2 = $reader.ReadByte()
			$planes = $reader.ReadUInt16()
			$bitCount = $reader.ReadUInt16()
			$bytesInRes = $reader.ReadUInt32()
			$imageOffset = $reader.ReadUInt32()

			if ($palette -ne 0) { throw "entry $i palette count must be 0" }
			if ($reserved2 -ne 0) { throw "entry $i reserved byte must be 0" }
			if ($bitCount -ne 32) { throw "entry $i bpp must be 32, got $bitCount" }

			$reportedSize = if ($width -eq 0) { 256 } else { [int]$width }
			if ($width -ne $height) { throw "entry $i width/height mismatch: $width/$height" }
			if ($reportedSize -ne $Sizes[$i]) { throw "entry $i size $reportedSize != expected $($Sizes[$i])" }

			# Verify the blob starts with a PNG signature and its embedded dimensions match.
			$png = New-Object byte[] $bytesInRes
			[System.Array]::Copy($bytes, $imageOffset, $png, 0, $bytesInRes)
			$pngSig = @(0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A)
			for ($s = 0; $s -lt 8; $s += 1) {
				if ($png[$s] -ne $pngSig[$s]) { throw "entry $i blob is not a PNG" }
			}
			$ihdrWidth = ([int]$png[16] -shl 24) -bor ([int]$png[17] -shl 16) -bor ([int]$png[18] -shl 8) -bor [int]$png[19]
			$ihdrHeight = ([int]$png[20] -shl 24) -bor ([int]$png[21] -shl 16) -bor ([int]$png[22] -shl 8) -bor [int]$png[23]
			if ($ihdrWidth -ne $reportedSize -or $ihdrHeight -ne $reportedSize) {
				throw "entry $i PNG IHDR ${ihdrWidth}x${ihdrHeight} != $reportedSize"
			}

			$reported += [pscustomobject]@{ Size = $reportedSize; Bytes = $bytesInRes; Offset = $imageOffset; Planes = $planes }
		}

		return $reported
	}
	finally {
		$reader.Dispose()
	}
}

Add-Type -AssemblyName System.Drawing

if (-not (Test-Path -LiteralPath $SourcePath)) {
	throw "Source icon not found: $SourcePath"
}

if (-not $ValidateOnly) {
	$sourceImage = [System.Drawing.Image]::FromFile($SourcePath)
	try {
		if ($sourceImage.Width -ne 1536 -or $sourceImage.Height -ne 1536) {
			throw "Source icon must be 1536x1536, got $($sourceImage.Width)x$($sourceImage.Height)"
		}
		$sourceBitmap = [System.Drawing.Bitmap]$sourceImage
		$entries = New-Object System.Collections.Generic.List[byte[]]
		foreach ($size in $Sizes) {
			$entries.Add((Resize-PngBytes -Source $sourceBitmap -Size $size))
		}
	}
	finally {
		$sourceImage.Dispose()
	}

	Write-Ico -Entries $entries -EntrySizes $Sizes -Path $OutputPath
	Write-Host "Wrote $OutputPath ($($entries.Count) PNG entries)"
}

$validated = Read-Ico -Path $OutputPath
foreach ($entry in $validated) {
	Write-Host ("  entry {0,3}px  {1,8} bytes  offset {2}" -f $entry.Size, $entry.Bytes, $entry.Offset)
}
Write-Host "ICO validation passed: $($validated.Count) sizes, all PNG-in-ICO."
